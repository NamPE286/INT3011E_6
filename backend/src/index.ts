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
        const url = new URL(request.url);

        if (
            request.method === "POST" &&
            url.pathname === "/__queue-test" &&
            url.hostname === "127.0.0.1"
        ) {
            const jobId = url.searchParams.get("jobId");

            if (!jobId) {
                return Response.json(
                    { error: "Thiếu jobId của job đã tồn tại trong D1" },
                    { status: 400 }
                );
            }

            await env.PROCESSING_QUEUE.send({ jobId });

            console.log("[Queue test] Đã gửi job:", jobId);

            return Response.json(
                { queued: true, jobId },
                { status: 202 }
            );
        }
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
