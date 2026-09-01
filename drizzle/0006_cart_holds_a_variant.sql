-- Written by hand. 0004 introduced product_stock — a product id, a variant
-- label and a quantity, unique on the first two — which is product_variants
-- from 0005 with a different name and without the position column or the
-- structured axes in variant_options that the storefront filters on. Two tables
-- for one fact is one of them being wrong, so this retires product_stock into
-- product_variants and repoints the cart at it.
--
-- drizzle-kit cannot generate this: it sees a table dropped beside a table
-- created and asks whether that is a rename, and a rename is exactly what it is
-- not — cart_items.stock_id has to be remapped, not relabelled.

-- The new rows take the old rows' ids. product_variants was created empty one
-- migration ago, so the ids are free, and taking them makes the cart remap
-- below an identity rather than a join that has to re-derive which variant a
-- label meant.
INSERT INTO `product_variants` (`id`, `product_id`, `label`, `stock_qty`, `position`)
SELECT
  ps.`id`,
  ps.`product_id`,
  -- product_stock spells "this product comes one way" as an empty label. The
  -- column here is NOT NULL and the label is what a customer is shown, so it
  -- gets the word the admin already uses. The middle branch is for the product
  -- that somehow holds both an empty label and a literal "Standard": without it
  -- the two would collide on product_variants_label_idx and take the whole
  -- migration down.
  CASE
    WHEN trim(ps.`variant_label`) <> '' THEN ps.`variant_label`
    WHEN EXISTS (
      SELECT 1 FROM `product_stock` o
      WHERE o.`product_id` = ps.`product_id` AND o.`variant_label` = 'Standard'
    ) THEN 'Standard ' || ps.`id`
    ELSE 'Standard'
  END,
  ps.`quantity`,
  0
FROM `product_stock` ps;--> statement-breakpoint

PRAGMA foreign_keys=OFF;--> statement-breakpoint

CREATE TABLE `__new_cart_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`variant_id` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint

-- variant_id is the old stock_id, because the insert above preserved the ids.
-- A line whose stock row has gone is dropped rather than carried: it points at
-- nothing that can be priced or picked, and a cart is recoverable in a way an
-- order is not.
INSERT INTO `__new_cart_items` (`id`, `session_id`, `product_id`, `variant_id`, `quantity`, `created_at`)
SELECT ci.`id`, ci.`session_id`, ci.`product_id`, ci.`stock_id`, ci.`quantity`, ci.`created_at`
FROM `cart_items` ci
WHERE EXISTS (SELECT 1 FROM `product_variants` pv WHERE pv.`id` = ci.`stock_id`);--> statement-breakpoint

DROP TABLE `cart_items`;--> statement-breakpoint
ALTER TABLE `__new_cart_items` RENAME TO `cart_items`;--> statement-breakpoint
CREATE UNIQUE INDEX `cart_items_session_variant_idx` ON `cart_items` (`session_id`,`variant_id`);--> statement-breakpoint

DROP TABLE `product_stock`;--> statement-breakpoint

PRAGMA foreign_keys=ON;
