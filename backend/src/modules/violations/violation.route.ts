import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { DEFAULT_OPENAI_MODEL } from "../processing/legal-llm.service";
import { extractViolationRules, getViolationRules } from "./violation.service";

// TODO(#4): the extract endpoint must require Admin authorization once authPlugin is implemented.
export const violationModule = new Elysia({ prefix: "/api" })
    .get(
        "/documents/:documentId/violation-rules",
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

            return getViolationRules(env.DB, params.documentId);
        },
        {
            params: t.Object({
                documentId: t.String(),
            }),
        }
    )
    .post(
        "/documents/:documentId/violation-rules/extract",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const result = await extractViolationRules(env.DB, params.documentId, {
                apiKey: env.OPENAI_API_KEY,
                model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
            });

            if (result.outcome === "NOT_FOUND") {
                set.status = 404;

                return { message: "Legal document not found" };
            }

            if (result.outcome === "REVIEW_REQUIRED") {
                set.status = 409;

                return { message: "The document still needs review, so its violation rules were not extracted" };
            }

            return result;
        },
        {
            params: t.Object({
                documentId: t.String(),
            }),
        }
    );
