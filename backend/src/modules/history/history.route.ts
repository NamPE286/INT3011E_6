import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { getViolationSummary } from "../identity/identity.repository";
import { getRulesAsOf, getViolationChanges, getViolationHistory, refreshHistory } from "./history.service";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// TODO(#4): the rebuild endpoint must require Admin authorization once authPlugin is implemented.
export const historyModule = new Elysia({ prefix: "/api" })
    .get(
        "/violations/:violationId/rules",
        async ({ params, query, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const asOf = query.as_of ?? new Date().toISOString().slice(0, 10);

            if (!ISO_DATE.test(asOf) || Number.isNaN(Date.parse(asOf))) {
                set.status = 400;

                return { message: "as_of must be a date in YYYY-MM-DD format" };
            }

            if (!(await getViolationSummary(env.DB, params.violationId))) {
                set.status = 404;

                return { message: "Traffic violation not found" };
            }

            return getRulesAsOf(env.DB, params.violationId, asOf);
        },
        {
            params: t.Object({
                violationId: t.String(),
            }),
            query: t.Object({
                as_of: t.Optional(t.String()),
            }),
        }
    )
    .get(
        "/violations/:violationId/history",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            if (!(await getViolationSummary(env.DB, params.violationId))) {
                set.status = 404;

                return { message: "Traffic violation not found" };
            }

            return getViolationHistory(env.DB, params.violationId);
        },
        {
            params: t.Object({
                violationId: t.String(),
            }),
        }
    )
    .get(
        "/violations/:violationId/changes",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            if (!(await getViolationSummary(env.DB, params.violationId))) {
                set.status = 404;

                return { message: "Traffic violation not found" };
            }

            return getViolationChanges(env.DB, params.violationId);
        },
        {
            params: t.Object({
                violationId: t.String(),
            }),
        }
    )
    .post("/history/rebuild", async ({ set, request }) => {
        const env = extractEnvFromRequest(request);

        if (!env?.DB) {
            set.status = 503;

            return { message: "Database service unavailable" };
        }

        return refreshHistory(env.DB);
    });
