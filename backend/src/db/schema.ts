import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const dummyItems = sqliteTable("dummy_items", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    message: text("message").notNull(),
});
