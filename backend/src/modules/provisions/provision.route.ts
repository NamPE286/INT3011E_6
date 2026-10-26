import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { listProvisions } from "./provision.repository";
import { analyzeStoredDocument, findDocumentIdByJobId } from "./provision.service";

// TODO(#4): these admin endpoints must require Admin authorization once authPlugin is implemented.
export const provisionModule = new Elysia({ prefix: "/api" })
    .get(
        "/jobs/:jobId/provisions",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const documentId = await findDocumentIdByJobId(env.DB, params.jobId);

            if (!documentId) {
                set.status = 404;

                return { message: "Legal document not found for this job" };
            }

            const provisions = await listProvisions(env.DB, documentId);

            return { jobId: params.jobId, documentId, provisions };
        },
        {
            params: t.Object({
                jobId: t.String(),
            }),
        }
    )
    .post(
        "/jobs/:jobId/provisions/analyze",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const result = await analyzeStoredDocument(env.DB, params.jobId);

            if (result.outcome === "NOT_FOUND") {
                set.status = 404;

                return { message: "Legal document not found for this job" };
            }

            if (result.outcome === "REVIEW_REQUIRED") {
                set.status = 409;

                return { message: "The document still needs review, so its provisions were not analyzed" };
            }

            return { jobId: params.jobId, documentId: result.documentId, summary: result.summary };
        },
        {
            params: t.Object({
                jobId: t.String(),
            }),
        }
    );
