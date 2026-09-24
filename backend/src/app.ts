import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { authPlugin } from "./plugins/auth";
import { contextPlugin } from "./plugins/context";
import { healthModule } from "./modules/health";
import { uploadModule } from "./modules/upload/upload.route";
import { processingModule } from "./modules/processing/processing.route";

export const app = new Elysia({ aot: false })
    .use(
        cors({
            origin: true,
            methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
            allowedHeaders: ["Content-Type", "Authorization"],
        })
    )
    .use(contextPlugin)
    .use(authPlugin)
    .use(healthModule)
    .use(uploadModule)
    .use(processingModule)
    .onError(({ code, error, set }) => {
        if (code === "VALIDATION") {
            set.status = 400;
            return {
                message: error.message,
            };
        }
    });
