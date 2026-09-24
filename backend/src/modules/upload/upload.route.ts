import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { processUpload, UploadValidationError } from "./upload.service";

export const uploadModule = new Elysia({ prefix: "/api" })
    .post(
        "/uploads",
        async ({ body, set, request }) => {
            const env = extractEnvFromRequest(request);
            if (!env?.DB || !env?.FILE_STORAGE || !env?.PROCESSING_QUEUE) {
                set.status = 503;
                return {
                    message: "Required Cloudflare services are not available",
                };
            }

            const rawFile = (body as { file?: unknown }).file;
            if (!(rawFile instanceof File)) {
                set.status = 400;
                return {
                    message: "A valid file must be provided under field 'file'",
                };
            }

            try {
                const result = await processUpload(rawFile, env);
                return result;
            } catch (err: unknown) {
                if (err instanceof UploadValidationError) {
                    set.status = 400;
                    return { message: err.message };
                }

                const message =
                    err instanceof Error ? err.message : "Internal server error";
                console.error("Upload handler error:", err);
                set.status = 500;
                return { message };
            }
        },
        {
            body: t.Object({
                file: t.File(),
            }),
        }
    );

