import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { buildChangeGraph, getDocumentChanges, getProvisionRelations } from "./change.service";

// TODO(#4): the rebuild endpoint must require Admin authorization once authPlugin is implemented.
export const changeModule = new Elysia({ prefix: "/api" })
    .get(
        "/documents/:documentId/changes",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const exists = await env.DB.prepare("SELECT id FROM legal_documents WHERE id = ?").bind(params.documentId).first();

            if (!exists) {
                set.status = 404;

                return { message: "Legal document not found" };
            }

            return getDocumentChanges(env.DB, params.documentId);
        },
        {
            params: t.Object({
                documentId: t.String(),
            }),
        }
    )
    .post(
        "/documents/:documentId/changes/rebuild",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const result = await buildChangeGraph(env.DB, params.documentId);

            if (result.outcome === "NOT_FOUND") {
                set.status = 404;

                return { message: "Legal document not found" };
            }

            if (result.outcome === "REVIEW_REQUIRED") {
                set.status = 409;

                return { message: "The document still needs review, so its change instructions were not built" };
            }

            return result;
        },
        {
            params: t.Object({
                documentId: t.String(),
            }),
        }
    )
    .get(
        "/provisions/:provisionId/relations",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const exists = await env.DB.prepare("SELECT id FROM provisions WHERE id = ?").bind(params.provisionId).first();

            if (!exists) {
                set.status = 404;

                return { message: "Provision not found" };
            }

            return getProvisionRelations(env.DB, params.provisionId);
        },
        {
            params: t.Object({
                provisionId: t.String(),
            }),
        }
    );
