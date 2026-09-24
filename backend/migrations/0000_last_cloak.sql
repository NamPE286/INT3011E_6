CREATE TABLE `dummy_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `dummy_items` (`id`, `message`)
VALUES (1, 'Drizzle is connected');
