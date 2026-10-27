import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { getDocumentView, searchDocuments } from "./document-query.service";

const MAX_SEARCH_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 20;

export const documentQueryModule = new Elysia({ prefix: "/api" })
    .get(
        "/documents",
        async ({ query, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            return searchDocuments(env.DB, {
                query: query.q ?? "",
                documentType: query.document_type ?? null,
                agency: query.agency ?? null,
                limit: query.limit ?? DEFAULT_SEARCH_LIMIT,
            });
        },
        {
            query: t.Object({
                q: t.Optional(t.String({ maxLength: 200 })),
                document_type: t.Optional(t.String({ maxLength: 100 })),
                agency: t.Optional(t.String({ maxLength: 200 })),
                limit: t.Optional(t.Numeric({ minimum: 1, maximum: MAX_SEARCH_LIMIT })),
            }),
        }
    )
    .get(
        "/documents/:documentId",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const view = await getDocumentView(env.DB, params.documentId);

            if (!view) {
                set.status = 404;

                return { message: "Legal document not found" };
            }

            return view;
        },
        {
            params: t.Object({
                documentId: t.String(),
            }),
        }
    );
