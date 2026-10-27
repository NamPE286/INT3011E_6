import type { MessageBatch } from "@cloudflare/workers-types";
import type { Env, ProcessingQueueMessage } from "../../types/env";
import { executeProcessingPipeline } from "./processing.service";
import { DEFAULT_OPENAI_MODEL } from "./legal-llm.service";
import { NeedsReviewError } from "./legal-types";
import { isPreprocessingStage, runQueuedStage } from "./preprocessing";

export async function handleProcessingBatch(
    batch: MessageBatch<ProcessingQueueMessage>, env: Env,
): Promise<void> {
    for (const message of batch.messages) {
        const { jobId, stage } = message.body ?? {};
        if (typeof jobId !== "string" || !jobId) {
            console.warn("[Queue] Invalid message:", message.body);
            message.ack();
            continue;
        }
        if (stage !== undefined) {
            if (isPreprocessingStage(stage)) {
                await runQueuedStage(env.DB, env.PROCESSING_QUEUE, jobId, stage, {
                    apiKey: env.OPENAI_API_KEY,
                    model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
                });
            } else {
                console.warn("[Queue] Unknown preprocessing stage:", stage);
            }

            message.ack();
            continue;
        }
        try {
            await executeProcessingPipeline(env, jobId);
            message.ack();
        } catch (error) {
            if (error instanceof NeedsReviewError) {
                console.warn(
                `[Queue] ACK permanent error: ${jobId}`,
                error.message
                );

                message.ack();
            } else {
                console.error(
                `[Queue] Retrying temporary error: ${jobId}`,
                error
                );

                message.retry();
            }
        }
    }
}
