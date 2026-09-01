CREATE TABLE `site_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slot` text NOT NULL,
	`alt_text` text DEFAULT '' NOT NULL,
	`original_filename` text NOT NULL,
	`original_sha256` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_images_slot_idx` ON `site_images` (`slot`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_image_derivatives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_id` integer,
	`site_image_id` integer,
	`format` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `product_images`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_image_id`) REFERENCES `site_images`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "image_derivatives_one_owner" CHECK(("__new_image_derivatives"."image_id" is null) <> ("__new_image_derivatives"."site_image_id" is null))
);
--> statement-breakpoint
-- site_image_id is omitted on purpose: the old table has no such column to
-- select, and every existing derivative belongs to a product image, so the
-- new column defaults to null and the one-owner check holds for every row.
INSERT INTO `__new_image_derivatives`("id", "image_id", "format", "width", "height", "byte_size", "sha256", "storage_key", "created_at") SELECT "id", "image_id", "format", "width", "height", "byte_size", "sha256", "storage_key", "created_at" FROM `image_derivatives`;--> statement-breakpoint
DROP TABLE `image_derivatives`;--> statement-breakpoint
ALTER TABLE `__new_image_derivatives` RENAME TO `image_derivatives`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `image_derivatives_rung_idx` ON `image_derivatives` (`image_id`,`format`,`width`);--> statement-breakpoint
CREATE UNIQUE INDEX `image_derivatives_site_rung_idx` ON `image_derivatives` (`site_image_id`,`format`,`width`);--> statement-breakpoint
CREATE INDEX `image_derivatives_key_idx` ON `image_derivatives` (`storage_key`);