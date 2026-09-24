import { Elysia } from "elysia";
import { createDatabase } from "../../db/client";
import { dummyItems } from "../../db/schema";
import { extractEnvFromRequest } from "../../plugins/context";

export const dummyModule = new Elysia().get("/api/dummy", async ({ request, set }) => {
    const env = extractEnvFromRequest(request);

    if (!env?.DB) {
        set.status = 503;

        return {
            message: "Database is unavailable",
        };
    }

    const database = createDatabase(env.DB);
    const [dummyItem] = await database.select().from(dummyItems).limit(1);

    if (!dummyItem) {
        set.status = 404;

        return {
            message: "Dummy row not found",
        };
    }

    return dummyItem;
});
