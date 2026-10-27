import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { resolveModel } from "../llm/models";
import { answerQuestion } from "./ask.service";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_QUESTION_LENGTH = 500;

export const askModule = new Elysia({ prefix: "/api" }).post(
    "/ask",
    async ({ body, set, request }) => {
        const env = extractEnvFromRequest(request);

        if (!env?.DB) {
            set.status = 503;

            return { message: "Database service unavailable" };
        }

        const question = body.question.trim();
        const asOf = body.as_of ?? new Date().toISOString().slice(0, 10);

        if (question.length === 0) {
            set.status = 400;

            return { message: "question must not be empty" };
        }

        if (!ISO_DATE.test(asOf) || Number.isNaN(Date.parse(asOf))) {
            set.status = 400;

            return { message: "as_of must be a date in YYYY-MM-DD format" };
        }

        const choice = resolveModel(body.model, env.OPENAI_MODEL);

        if (!choice.ok) {
            set.status = 400;

            return { message: "model is not supported" };
        }

        return answerQuestion(env.DB, { question, asOf }, { apiKey: env.OPENAI_API_KEY, model: choice.model });
    },
    {
        body: t.Object({
            question: t.String({ maxLength: MAX_QUESTION_LENGTH }),
            as_of: t.Optional(t.String()),
            model: t.Optional(t.String({ maxLength: 64 })),
        }),
    }
);
