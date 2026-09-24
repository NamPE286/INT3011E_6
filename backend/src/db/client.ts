import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function createDatabase(d1Database: D1Database) {
    return drizzle(d1Database, { schema });
}

export type Database = ReturnType<typeof createDatabase>;
