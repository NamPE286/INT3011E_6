import { Elysia } from "elysia";
import { authPlugin } from "./plugins/auth";
import { healthModule } from "./modules/health";

export const app = new Elysia()
    .use(authPlugin)
    .use(healthModule);

