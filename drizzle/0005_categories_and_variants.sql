CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_idx` ON `categories` (`slug`);--> statement-breakpoint
CREATE INDEX `categories_position_idx` ON `categories` (`position`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`label` text NOT NULL,
	`stock_qty` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_variants_product_idx` ON `product_variants` (`product_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_label_idx` ON `product_variants` (`product_id`,`label`);--> statement-breakpoint
CREATE TABLE `variant_options` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`name` text NOT NULL,
	`name_slug` text NOT NULL,
	`value` text NOT NULL,
	`value_slug` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variant_options_axis_idx` ON `variant_options` (`variant_id`,`name_slug`);--> statement-breakpoint
CREATE INDEX `variant_options_facet_idx` ON `variant_options` (`name_slug`,`value_slug`);--> statement-breakpoint
-- 0004 created this index as sessions_token_unique while schema.ts declares it
-- as sessions_token_idx, so every future generate would re-emit this rename
-- until one of them ran. Same column and same uniqueness either way.
DROP INDEX `sessions_token_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_idx` ON `sessions` (`token`);--> statement-breakpoint
-- drizzle-kit emits this REFERENCES clause without the ON DELETE the schema
-- declares, which would leave deleting a category a constraint error rather
-- than the unshelving products.category_id is documented to be. Corrected by
-- hand; test/migrations.test.ts holds it corrected.
ALTER TABLE `products` ADD `category_id` integer REFERENCES categories(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_price_idx` ON `products` (`price_paisa`);