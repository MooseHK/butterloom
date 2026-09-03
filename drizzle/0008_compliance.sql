ALTER TABLE `products` ADD `origin_country` text DEFAULT 'Bangladesh';--> statement-breakpoint
ALTER TABLE `products` ADD `material` text DEFAULT 'Cotton';--> statement-breakpoint
ALTER TABLE `products` ADD `measurements` text DEFAULT 'Standard';--> statement-breakpoint
ALTER TABLE `products` ADD `returns_policy` text;--> statement-breakpoint
UPDATE `products` SET `origin_country` = 'Bangladesh' WHERE `origin_country` IS NULL;--> statement-breakpoint
UPDATE `products` SET `material` = 'Cotton' WHERE `material` IS NULL;--> statement-breakpoint
UPDATE `products` SET `measurements` = 'Standard' WHERE `measurements` IS NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `vat_rate_bp` integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `vat_paisa` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `consent_version` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `consent_granted_at` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `redacted_at` integer;--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);--> statement-breakpoint
INSERT INTO `settings` (`key`, `value`) VALUES ('vat_rate_bp', '1000');--> statement-breakpoint
CREATE TABLE `invoice_sequence` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_serial` integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
INSERT INTO `invoice_sequence` (`id`, `last_serial`) VALUES (1, 0);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`serial_number` integer NOT NULL,
	`mushak_number` text NOT NULL,
	`total_paisa` integer NOT NULL,
	`vat_rate_bp` integer NOT NULL,
	`vat_paisa` integer NOT NULL,
	`net_paisa` integer NOT NULL,
	`customer_name` text NOT NULL,
	`customer_phone` text NOT NULL,
	`customer_address` text NOT NULL,
	`bin_number` text,
	`issued_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_serial_idx` ON `invoices` (`serial_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_order_idx` ON `invoices` (`order_id`);
