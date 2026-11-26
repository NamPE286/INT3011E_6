import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { getDocumentView } from "../documents/document-query.service";
import { resolveModel } from "../llm/models";
import { analyzeDraftContent } from "./ide.analyzer";
import { runLegalDebugSimulation } from "./ide.debug";
import { buildExportFilename, buildVietnameseLegalDocx, buildVietnameseLegalHtml } from "./ide.export";
import {
    buildSampleLibraryZip,
    deleteLibraryLawFromWorkspace,
    extractLawsFromZipArchive,
    importBaseLawsBatch,
    type ImportLibraryInput,
} from "./ide.library";
import { deleteSavedDraft, findSavedDraft, insertSavedDraft, listSavedDrafts, updateSavedDraft } from "./ide.repository";
import { BUILTIN_TEMPLATES, findBuiltinTemplate, formatCorpusDocumentAsDraft } from "./ide.templates";
import type { DraftDocument, DraftSummary } from "./ide.types";
import { loadWorkspaceContext } from "./ide.workspace";

const MAX_DRAFT_CONTENT_LENGTH = 100_000;

export const ideModule = new Elysia({ prefix: "/api/ide" })
    .get("/workspace-context", async ({ request }) => {
        const env = extractEnvFromRequest(request);

        return loadWorkspaceContext(env?.DB);
    })
    .get("/drafts", async ({ request }) => {
        const env = extractEnvFromRequest(request);
        const saved = env?.DB ? await safeListSaved(env.DB) : [];

        const drafts = await Promise.all(saved.map((item) => summarizeDraft(item)));
        const templates = await Promise.all(BUILTIN_TEMPLATES.map((item) => summarizeDraft(item)));

        return {
            drafts,
            templates,
        };
    })
    .get(
        "/drafts/:id",
        async ({ params, set, request }) => {
            const template = findBuiltinTemplate(params.id);

            if (template) {
                const analysis = await analyzeDraftContent(template.content, {
                    db: extractEnvFromRequest(request)?.DB,
                });

                return { draft: template, analysis };
            }

            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const draft = await findSavedDraft(env.DB, params.id);

            if (!draft) {
                set.status = 404;

                return { message: "Draft document not found" };
            }

            const analysis = await analyzeDraftContent(draft.content, { db: env.DB });

            return { draft, analysis };
        },
        {
            params: t.Object({
                id: t.String({ minLength: 1, maxLength: 128 }),
            }),
        },
    )
    .post(
        "/drafts",
        async ({ body, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            let title = body.title?.trim() ?? "";
            let content = body.content ?? "";
            let documentNumber = body.documentNumber?.trim() || null;
            let documentType = body.documentType?.trim() || null;
            let agency = body.agency?.trim() || null;
            const sourceDocumentId = body.sourceDocumentId?.trim() || null;

            if (sourceDocumentId) {
                const view = await getDocumentView(env.DB, sourceDocumentId);

                if (!view) {
                    set.status = 404;

                    return { message: "Source legal document not found" };
                }

                title = title || `Sửa đổi ${view.metadata?.documentNumber ?? view.document.title ?? view.document.id}`;
                documentNumber = documentNumber ?? (view.metadata?.documentNumber ? `${view.metadata.documentNumber} (Dự thảo)` : null);
                documentType = documentType ?? view.metadata?.documentType ?? null;
                agency = agency ?? view.metadata?.agency ?? null;
                content = content || formatCorpusDocumentAsDraft(view);
            } else if (body.templateId) {
                const template = findBuiltinTemplate(body.templateId);

                if (!template) {
                    set.status = 404;

                    return { message: "Template not found" };
                }

                title = title || `${template.title} (Bản sao)`;
                documentNumber = documentNumber ?? template.documentNumber;
                documentType = documentType ?? template.documentType;
                agency = agency ?? template.agency;
                content = content || template.content;
            }

            if (!title) {
                title = "Dự thảo văn bản mới";
            }

            if (content.length > MAX_DRAFT_CONTENT_LENGTH) {
                set.status = 400;

                return { message: "Draft content exceeds maximum length" };
            }

            const id = `draft-${crypto.randomUUID()}`;
            const draft = await insertSavedDraft(env.DB, {
                id,
                title,
                documentNumber,
                documentType,
                agency,
                content,
                sourceDocumentId,
            });
            const analysis = await analyzeDraftContent(draft.content, { db: env.DB });

            set.status = 201;

            return { draft, analysis };
        },
        {
            body: t.Object({
                title: t.Optional(t.String({ maxLength: 300 })),
                documentNumber: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
                documentType: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
                agency: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()])),
                content: t.Optional(t.String({ maxLength: MAX_DRAFT_CONTENT_LENGTH })),
                templateId: t.Optional(t.String({ maxLength: 100 })),
                sourceDocumentId: t.Optional(t.String({ maxLength: 128 })),
            }),
        },
    )
    .put(
        "/drafts/:id",
        async ({ params, body, set, request }) => {
            if (findBuiltinTemplate(params.id)) {
                set.status = 400;

                return { message: "Built-in templates cannot be overwritten; save as a new draft instead" };
            }

            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const updated = await updateSavedDraft(env.DB, params.id, {
                title: body.title?.trim(),
                documentNumber: body.documentNumber,
                documentType: body.documentType,
                agency: body.agency,
                content: body.content,
            });

            if (!updated) {
                set.status = 404;

                return { message: "Draft document not found" };
            }

            const analysis = await analyzeDraftContent(updated.content, { db: env.DB });

            return { draft: updated, analysis };
        },
        {
            params: t.Object({
                id: t.String({ minLength: 1, maxLength: 128 }),
            }),
            body: t.Object({
                title: t.Optional(t.String({ minLength: 1, maxLength: 300 })),
                documentNumber: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
                documentType: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
                agency: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()])),
                content: t.Optional(t.String({ maxLength: MAX_DRAFT_CONTENT_LENGTH })),
            }),
        },
    )
    .delete(
        "/drafts/:id",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const deleted = await deleteSavedDraft(env.DB, params.id);

            if (!deleted) {
                set.status = 404;

                return { message: "Draft document not found" };
            }

            return { deleted: true };
        },
        {
            params: t.Object({
                id: t.String({ minLength: 1, maxLength: 128 }),
            }),
        },
    )
    .post(
        "/analyze",
        async ({ body, set, request }) => {
            const env = extractEnvFromRequest(request);
            const includeAi = body.includeAi ?? false;
            const choice = resolveModel(body.model, env?.GEMINI_MODEL ?? env?.OPENAI_MODEL);

            if (!choice.ok) {
                set.status = 400;

                return { message: "model is not supported" };
            }

            return analyzeDraftContent(body.content, {
                db: env?.DB,
                includeAi,
                apiKey: env?.GEMINI_API_KEY ?? env?.OPENAI_API_KEY,
                model: choice.model,
            });
        },
        {
            body: t.Object({
                content: t.String({ maxLength: MAX_DRAFT_CONTENT_LENGTH }),
                includeAi: t.Optional(t.Boolean()),
                model: t.Optional(t.String({ maxLength: 64 })),
            }),
        },
    )
    .post(
        "/debug",
        async ({ body, set, request }) => {
            const env = extractEnvFromRequest(request);
            const useAi = body.useAi ?? false;
            const choice = resolveModel(body.model, env?.GEMINI_MODEL ?? env?.OPENAI_MODEL);

            if (!choice.ok) {
                set.status = 400;

                return { message: "model is not supported" };
            }

            return runLegalDebugSimulation({
                content: body.content,
                scenario: body.scenario.trim(),
                db: env?.DB,
                ambiguityOverrides: body.ambiguityOverrides,
                useAi,
                apiKey: env?.GEMINI_API_KEY ?? env?.OPENAI_API_KEY,
                model: choice.model,
            });
        },
        {
            body: t.Object({
                content: t.String({ maxLength: MAX_DRAFT_CONTENT_LENGTH }),
                scenario: t.String({ minLength: 3, maxLength: 2000 }),
                ambiguityOverrides: t.Optional(t.Record(t.String(), t.Boolean())),
                useAi: t.Optional(t.Boolean()),
                model: t.Optional(t.String({ maxLength: 64 })),
            }),
        },
    )
    .post(
        "/library/import",
        async ({ body, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const rawItems = "laws" in body ? body.laws : [body];
            const normalized: ImportLibraryInput[] = [];

            for (const entry of rawItems) {
                const title = entry.title.trim();
                const documentNumber = entry.documentNumber.trim();

                if (!title || !documentNumber || entry.content.trim().length === 0) {
                    set.status = 400;

                    return { message: "title, documentNumber, and content are required" };
                }

                normalized.push({
                    title,
                    documentNumber,
                    documentType: entry.documentType?.trim() || "Luật",
                    agency: entry.agency?.trim() || null,
                    content: entry.content,
                });
            }

            const items = await importBaseLawsBatch(env.DB, normalized);
            set.status = 201;

            return {
                imported: items[0],
                items,
                count: items.length,
            };
        },
        {
            body: t.Union([
                t.Object({
                    title: t.String({ minLength: 1, maxLength: 300 }),
                    documentNumber: t.String({ minLength: 1, maxLength: 100 }),
                    documentType: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
                    agency: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()])),
                    content: t.String({ minLength: 1, maxLength: MAX_DRAFT_CONTENT_LENGTH }),
                }),
                t.Object({
                    laws: t.Array(
                        t.Object({
                            title: t.String({ minLength: 1, maxLength: 300 }),
                            documentNumber: t.String({ minLength: 1, maxLength: 100 }),
                            documentType: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
                            agency: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()])),
                            content: t.String({ minLength: 1, maxLength: MAX_DRAFT_CONTENT_LENGTH }),
                        }),
                        { minItems: 1, maxItems: 50 },
                    ),
                }),
            ]),
        },
    )
    .post("/library/import-zip", async ({ body, request, set }) => {
        const env = extractEnvFromRequest(request);

        if (!env?.DB) {
            set.status = 503;

            return { message: "Database service unavailable" };
        }

        let zipBytes: Uint8Array;

        try {
            if (body instanceof Uint8Array) {
                zipBytes = body;
            } else if (body instanceof ArrayBuffer) {
                zipBytes = new Uint8Array(body);
            } else if (typeof body === "object" && body !== null && "file" in body && (body as { file?: unknown }).file instanceof Blob) {
                zipBytes = new Uint8Array(await ((body as { file: Blob }).file).arrayBuffer());
            } else {
                const contentType = request.headers.get("content-type") ?? "";

                if (contentType.includes("multipart/form-data")) {
                    const form = await request.formData();
                    const file = form.get("file");

                    if (!(file instanceof Blob)) {
                        set.status = 400;

                        return { message: "Thiếu tệp gói .zip trong trường 'file'." };
                    }

                    zipBytes = new Uint8Array(await file.arrayBuffer());
                } else {
                    zipBytes = new Uint8Array(await request.arrayBuffer());
                }
            }
        } catch {
            set.status = 400;

            return { message: "Không thể đọc dữ liệu tệp .zip tải lên." };
        }

        if (zipBytes.byteLength === 0 || zipBytes.byteLength > 10 * 1024 * 1024) {
            set.status = 400;

            return { message: "Dung lượng tệp .zip phải nằm trong khoảng 1 byte đến 10 MB." };
        }

        try {
            const { laws, skipped } = await extractLawsFromZipArchive(zipBytes);

            if (laws.length === 0) {
                set.status = 400;

                return {
                    message: "Gói .zip không chứa tệp luật hợp lệ (.txt, .md, .luat, .json).",
                    skipped,
                };
            }

            const items = await importBaseLawsBatch(env.DB, laws);
            set.status = 201;

            return {
                imported: items[0],
                items,
                count: items.length,
                skipped,
            };
        } catch (cause: unknown) {
            set.status = 400;

            return {
                message: cause instanceof Error ? cause.message : "Không thể giải nén gói .zip.",
            };
        }
    })
    .get("/library/sample-zip", () => {
        const bytes = buildSampleLibraryZip();
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);

        return new Response(copy, {
            status: 200,
            headers: {
                "content-type": "application/zip",
                "content-disposition": 'attachment; filename="bo-luat-mau-lexide.zip"',
            },
        });
    })
    .delete(
        "/library/:id",
        async ({ params, set, request }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const deleted = await deleteLibraryLawFromWorkspace(env.DB, params.id);

            if (!deleted) {
                set.status = 404;

                return { message: "Library document not found" };
            }

            return { deleted: true };
        },
        {
            params: t.Object({
                id: t.String({ minLength: 1, maxLength: 128 }),
            }),
        },
    )
    .post(
        "/export/docx",
        ({ body }) => {
            const bytes = buildVietnameseLegalDocx({
                title: body.title.trim() || "Dự thảo văn bản quy phạm pháp luật",
                documentNumber: body.documentNumber,
                documentType: body.documentType,
                agency: body.agency,
                content: body.content,
            });
            const copy = new Uint8Array(bytes.byteLength);
            copy.set(bytes);
            const filename = buildExportFilename(body.documentNumber, body.title, "docx");

            return new Response(copy, {
                status: 200,
                headers: {
                    "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "content-disposition": `attachment; filename="${filename}"`,
                },
            });
        },
        {
            body: t.Object({
                title: t.String({ maxLength: 300 }),
                documentNumber: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
                documentType: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
                agency: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()])),
                content: t.String({ maxLength: MAX_DRAFT_CONTENT_LENGTH }),
            }),
        },
    )
    .post(
        "/export/html",
        ({ body }) => {
            const html = buildVietnameseLegalHtml({
                title: body.title.trim() || "Dự thảo văn bản quy phạm pháp luật",
                documentNumber: body.documentNumber,
                documentType: body.documentType,
                agency: body.agency,
                content: body.content,
            });

            return new Response(html, {
                status: 200,
                headers: {
                    "content-type": "text/html; charset=utf-8",
                },
            });
        },
        {
            body: t.Object({
                title: t.String({ maxLength: 300 }),
                documentNumber: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
                documentType: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
                agency: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()])),
                content: t.String({ maxLength: MAX_DRAFT_CONTENT_LENGTH }),
            }),
        },
    );

async function safeListSaved(db: NonNullable<ReturnType<typeof extractEnvFromRequest>>["DB"]): Promise<DraftDocument[]> {
    if (!db) {
        return [];
    }

    try {
        return await listSavedDrafts(db);
    } catch {
        return [];
    }
}

async function summarizeDraft(draft: DraftDocument): Promise<DraftSummary> {
    const analysis = await analyzeDraftContent(draft.content);

    return {
        id: draft.id,
        title: draft.title,
        documentNumber: draft.documentNumber,
        documentType: draft.documentType,
        agency: draft.agency,
        sourceDocumentId: draft.sourceDocumentId,
        isTemplate: draft.isTemplate,
        updatedAt: draft.updatedAt,
        errorCount: analysis.metrics.countsBySeverity.error,
        warningCount: analysis.metrics.countsBySeverity.warning,
        infoCount: analysis.metrics.countsBySeverity.info,
    };
}
