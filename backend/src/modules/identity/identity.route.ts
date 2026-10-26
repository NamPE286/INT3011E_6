import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { DEFAULT_OPENAI_MODEL } from "../processing/legal-llm.service";
import { listViolationRulesOf } from "../violations/violation.repository";
import { listIdentityDecisions } from "./identity.repository";
import { findViolations, getViolationDetail, resolveDocumentIdentities } from "./identity.service";

// TODO(#4): the resolve endpoint must require Admin authorization once authPlugin is implemented.
export const identityModule = new Elysia({ prefix: "/api" })
    .get(
        "/violations",
        async ({ query, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const violations = await findViolations(env.DB, query.q ?? "", query.limit ? Number(query.limit) : 20);

            return { query: query.q ?? "", violations };
        },
        {
            query: t.Object({
                q: t.Optional(t.String()),
                limit: t.Optional(t.Numeric()),
            }),
        }
    )
    .get(
        "/violations/:violationId",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const violation = await getViolationDetail(env.DB, params.violationId);

            if (!violation) {
                set.status = 404;

                return { message: "Traffic violation not found" };
            }

            return violation;
        },
        {
            params: t.Object({
                violationId: t.String(),
            }),
        }
    )
    .get(
        "/documents/:documentId/identities",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const rules = await listViolationRulesOf(env.DB, params.documentId);
            const decisions = await listIdentityDecisions(env.DB, rules.map((rule) => rule.id));

            return { documentId: params.documentId, decisions };
        },
        {
            params: t.Object({
                documentId: t.String(),
            }),
        }
    )
    .post(
        "/documents/:documentId/identities/resolve",
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

            return resolveDocumentIdentities(env.DB, params.documentId, {
                apiKey: env.OPENAI_API_KEY,
                model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
            });
        },
        {
            params: t.Object({
                documentId: t.String(),
            }),
        }
    );
