import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { authPlugin } from "./plugins/auth";
import { contextPlugin } from "./plugins/context";
import { healthModule } from "./modules/health";
import { uploadModule } from "./modules/upload/upload.route";
import { processingModule } from "./modules/processing/processing.route";
import { dummyModule } from "./modules/dummy/dummy.route";
import { mcpModule } from "./modules/mcp/mcp.route";
import { provisionModule } from "./modules/provisions/provision.route";
import { documentQueryModule } from "./modules/documents/document.route";
import { documentGraphModule } from "./modules/documents/document-graph.route";
import { changeModule } from "./modules/changes/change.route";
import { violationModule } from "./modules/violations/violation.route";
import { identityModule } from "./modules/identity/identity.route";
import { askModule } from "./modules/ask/ask.route";
import { modelsModule } from "./modules/llm/models.route";
import { historyModule } from "./modules/history/history.route";
import { graphModule } from "./modules/graph/graph.route";
import { authModule } from "./modules/auth/auth.route";
import { workspaceModule } from "./modules/workspaces/workspace.route";
import { manualModule } from "./modules/manual/manual.route";
import { analysisModule } from "./modules/analysis/analysis.route";
import { ideModule } from "./modules/ide/ide.route";

export const app = new Elysia({ aot: false })
    .use(
        cors({
            origin: true,
            credentials: true,
            methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
            allowedHeaders: ["Content-Type", "Authorization", "X-Workspace-Id"],
        })
    )
    .use(contextPlugin)
    .use(authPlugin)
    .use(authModule)
    .use(workspaceModule)
    .use(manualModule)
    .use(analysisModule)
    .use(healthModule)
    .use(uploadModule)
    .use(processingModule)
    .use(provisionModule)
    .use(documentQueryModule)
    .use(documentGraphModule)
    .use(changeModule)
    .use(violationModule)
    .use(identityModule)
    .use(historyModule)
    .use(graphModule)
    .use(askModule)
    .use(modelsModule)
    .use(ideModule)
    .use(dummyModule)
    .use(mcpModule)
    .onError(({ code, error, set }) => {
        if (code === "VALIDATION") {
            set.status = 400;
            return {
                message: error.message,
            };
        }
    });
