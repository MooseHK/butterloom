CREATE TABLE `pending_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`alt_text` text DEFAULT '' NOT NULL,
	`original_filename` text NOT NULL,
	`content_type` text NOT NULL,
	`original_sha256` text NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pending_images_product_idx` ON `pending_images` (`product_id`);