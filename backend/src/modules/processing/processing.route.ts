import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { getJobById, getRecentJobs, toJobResponse } from "./processing.service";

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
    );

