import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { resolveWorkspaceAccess } from "../workspaces/workspace.service";
import { deleteLeafDocument, listDependentDocuments } from "./document-deletion.service";
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

            const access = await resolveWorkspaceAccess(env, request);

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            return searchDocuments(env.DB, {
                query: query.q ?? "",
                documentType: query.document_type ?? null,
                agency: query.agency ?? null,
                limit: query.limit ?? DEFAULT_SEARCH_LIMIT,
                workspaceId: access.workspaceId,
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

            const access = await resolveWorkspaceAccess(env, request);

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const view = await getDocumentView(env.DB, params.documentId, access.workspaceId);

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
    )
    .get(
        "/documents/:documentId/dependents",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const dependents = await listDependentDocuments(env.DB, params.documentId);

            return { documentId: params.documentId, deletable: dependents.length === 0, dependents };
        },
        {
            params: t.Object({
                documentId: t.String(),
            }),
        }
    )
    .delete(
        "/documents/:documentId",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const result = await deleteLeafDocument(env.DB, env.FILE_STORAGE, params.documentId);

            if (result.outcome === "NOT_FOUND") {
                set.status = 404;

                return { message: "Legal document not found" };
            }

            if (result.outcome === "HAS_DEPENDENTS") {
                set.status = 409;

                return { message: "Only a document no other document acts on can be deleted", dependents: result.dependents };
            }

            return result;
        },
        {
            params: t.Object({
                documentId: t.String(),
            }),
        }
    );
