-- Written by hand, because it is two statements and drizzle-kit wants a
-- snapshot bump to say the same thing.
--
-- A product an operator has taken off the storefront. Null means it is on the
-- storefront, which is every row that exists today — so the column is
-- nullable with no default and the backfill is the absence of one.
--
-- This is not the `category_id is null` state the schema already calls
-- "unshelved": that one stays listed under All items and reachable at its own
-- URL. See the comment on products.hidden_at.
ALTER TABLE `products` ADD `hidden_at` integer;--> statement-breakpoint
CREATE INDEX `products_hidden_idx` ON `products` (`hidden_at`);
