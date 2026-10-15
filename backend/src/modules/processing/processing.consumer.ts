import type { MessageBatch } from "@cloudflare/workers-types";
import type { Env, ProcessingQueueMessage } from "../../types/env";
import { executeProcessingPipeline } from "./processing.service";
import { NeedsReviewError } from "./legal-types";

export async function handleProcessingBatch(
    batch: MessageBatch<ProcessingQueueMessage>, env: Env,
): Promise<void> {
    for (const message of batch.messages) {
        const { jobId } = message.body ?? {};
        if (typeof jobId !== "string" || !jobId) {
            console.warn("[Queue] Invalid message:", message.body);
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
