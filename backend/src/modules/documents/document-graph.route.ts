import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { buildDocumentGraph, getDocumentRelations } from "./document-graph.service";

// TODO(#4): the rebuild endpoint must require Admin authorization once authPlugin is implemented.
export const documentGraphModule = new Elysia({ prefix: "/api" })
    .get(
        "/documents/:documentId/relations",
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

            return getDocumentRelations(env.DB, params.documentId);
        },
        {
            params: t.Object({
                documentId: t.String(),
            }),
        }
    )
    .post(
        "/documents/:documentId/relations/rebuild",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const result = await buildDocumentGraph(env.DB, params.documentId);

            if (result.outcome === "NOT_FOUND") {
                set.status = 404;

                return { message: "Legal document not found" };
            }

            if (result.outcome === "REVIEW_REQUIRED") {
                set.status = 409;

                return { message: "The document still needs review, so its relations were not built" };
            }

            return result;
        },
        {
            params: t.Object({
                documentId: t.String(),
            }),
        }
    );
