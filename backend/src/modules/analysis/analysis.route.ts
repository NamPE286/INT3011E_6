import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { resolveWorkspaceAccess } from "../workspaces/workspace.service";
import {
    analyzeWorkspaceDocumentImpact,
    auditWorkspaceDocument,
    getWorkspaceAuditOverview,
} from "./analysis.service";

export const analysisModule = new Elysia({ prefix: "/api" })
    .get(
        "/documents/:documentId/audit",
        async ({ params, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const access = await resolveWorkspaceAccess(env, request);

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const report = await auditWorkspaceDocument(env.DB, access.workspaceId, params.documentId);

            if (!report) {
                set.status = 404;

                return { message: "Không tìm thấy văn bản trong không gian làm việc" };
            }

            return report;
        },
        {
            params: t.Object({ documentId: t.String() }),
        },
    )
    .get(
        "/documents/:documentId/impact",
        async ({ params, query, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const access = await resolveWorkspaceAccess(env, request);

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const parsedDepth = query.max_depth ? Number(query.max_depth) : 3;

            if (!Number.isInteger(parsedDepth) || parsedDepth < 1 || parsedDepth > 5) {
                set.status = 400;

                return { message: "max_depth phải là số nguyên từ 1 đến 5" };
            }

            const report = await analyzeWorkspaceDocumentImpact(env.DB, access.workspaceId, params.documentId, parsedDepth);

            if (!report) {
                set.status = 404;

                return { message: "Không tìm thấy văn bản trong không gian làm việc" };
            }

            return report;
        },
        {
            params: t.Object({ documentId: t.String() }),
            query: t.Object({
                max_depth: t.Optional(t.String()),
            }),
        },
    )
    .get("/workspace/audit-summary", async ({ request, set }) => {
        const env = extractEnvFromRequest(request);

        if (!env?.DB) {
            set.status = 503;

            return { message: "Database service unavailable" };
        }

        const access = await resolveWorkspaceAccess(env, request);

        if (!access.ok) {
            set.status = access.status;

            return { message: access.message };
        }

        return getWorkspaceAuditOverview(env.DB, access.workspaceId);
    });
