DROP INDEX `image_derivatives_image_idx`;--> statement-breakpoint
DROP INDEX `image_derivatives_key_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `image_derivatives_rung_idx` ON `image_derivatives` (`image_id`,`format`,`width`);--> statement-breakpoint
CREATE INDEX `image_derivatives_key_idx` ON `image_derivatives` (`storage_key`);