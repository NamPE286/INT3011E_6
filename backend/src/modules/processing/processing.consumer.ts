import type { MessageBatch } from "@cloudflare/workers-types";
import type { Env, ProcessingQueueMessage } from "../../types/env";
import type { Sleep } from "./processing.types";
import { executeProcessingPipeline, defaultSleep } from "./processing.service";

export async function handleProcessingBatch(
    batch: MessageBatch<ProcessingQueueMessage>,
    env: Env,
    sleepFn: Sleep = defaultSleep
): Promise<void> {
    for (const message of batch.messages) {
        const { jobId } = message.body;
        if (!jobId || typeof jobId !== "string") {
            console.warn("[QueueConsumer] Skipping invalid message body:", message.body);
            message.ack();
            continue;
        }

        try {
            await executeProcessingPipeline(env.DB, jobId, sleepFn);
            message.ack();
        } catch (error: unknown) {
            console.error(`[QueueConsumer] Failed to process job ${jobId}:`, error);
            // We acknowledge or retry based on message failure
            message.retry();
        }
    }
}

