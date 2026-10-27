import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { getJobById, getRecentJobs, toJobResponse } from "./job.repository";
import { acceptReviewedDocument, getLegalDocumentByJobId } from "./legal-persistence";
import { DEFAULT_OPENAI_MODEL } from "./legal-llm.service";
import { runPreprocessing } from "./preprocessing";

// TODO(#4): these admin endpoints must require Admin authorization once authPlugin is implemented.
export const processingModule = new Elysia({ prefix: "/api" })
    .get("/jobs", async ({ set, request }) => {
        const env = extractEnvFromRequest(request);

        if (!env?.DB) {
            set.status = 503;

            return { message: "Database service unavailable" };
        }

        const jobs = await getRecentJobs(env.DB);

        return { jobs: jobs.map(toJobResponse) };
    })
    .get(
        "/jobs/:jobId",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const job = await getJobById(env.DB, params.jobId);

            if (!job) {
                set.status = 404;

                return { message: "Job not found" };
            }

            return toJobResponse(job);
        },
        {
            params: t.Object({
                jobId: t.String(),
            }),
        }
    )
    .get(
        "/jobs/:jobId/document",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const stored = await getLegalDocumentByJobId(env.DB, params.jobId);

            if (!stored) {
                set.status = 404;

                return { message: "Legal document not found for this job" };
            }

            return {
                jobId: stored.jobId,
                reviewStatus: stored.reviewStatus,
                issues: stored.issues,
                extraction: {
                    model: stored.model,
                    promptVersion: stored.promptVersion,
                    schemaVersion: stored.schemaVersion,
                    pageCount: stored.pageCount,
                    pdfSha256: stored.pdfSha256,
                    createdAt: stored.createdAt,
                },
                document: stored.document,
            };
        },
        {
            params: t.Object({
                jobId: t.String(),
            }),
        }
    )
    .post(
        "/jobs/:jobId/review",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const stored = await getLegalDocumentByJobId(env.DB, params.jobId);

            if (!stored) {
                set.status = 404;

                return { message: "Legal document not found for this job" };
            }

            const accepted = await acceptReviewedDocument(env.DB, params.jobId);

            if (!accepted) {
                set.status = 409;

                return { message: "The document is not waiting for review" };
            }

            const model = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;

            await runPreprocessing(env.DB, params.jobId, { apiKey: env.OPENAI_API_KEY, model });

            return { jobId: params.jobId, reviewStatus: "ACCEPTED" };
        },
        {
            params: t.Object({
                jobId: t.String(),
            }),
            body: t.Object({
                decision: t.Literal("accept"),
            }),
        }
    );
