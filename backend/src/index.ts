import type { ExecutionContext, MessageBatch } from "@cloudflare/workers-types";
import { app } from "./app";
import type { Env, ProcessingQueueMessage } from "./types/env";
import { handleProcessingBatch } from "./modules/processing/processing.consumer";

export default {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext
    ): Promise<Response> {
        const enrichedRequest = request as unknown as {
            env?: unknown;
            ctx?: unknown;
        };
        enrichedRequest.env = env;
        enrichedRequest.ctx = ctx;

        return app.fetch(request);
    },

    async queue(
        batch: MessageBatch<ProcessingQueueMessage>,
        env: Env,
        _ctx: ExecutionContext
    ): Promise<void> {
        await handleProcessingBatch(batch, env);
    },
};

if (import.meta.main) {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

    app.listen(port, () => {
        console.log(
            `Server is running at http://${app.server?.hostname ?? "localhost"}:${app.server?.port ?? port}`
        );
    });
}
