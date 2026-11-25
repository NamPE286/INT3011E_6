import { Elysia, t } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { resolveWorkspaceAccess } from "../workspaces/workspace.service";
import {
    createManualDocument,
    createManualDocumentRelation,
    createManualProvisionRelation,
    createManualSanctionEdge,
    deleteManualDocument,
    deleteManualDocumentRelation,
    deleteManualProvision,
    deleteManualProvisionRelation,
    deleteManualSanctionEdge,
    insertManualProvision,
    updateManualDocument,
    updateManualProvision,
    type ManualProvisionLevel,
} from "./manual.service";

const PROVISION_LEVELS = t.Union([
    t.Literal("CHAPTER"),
    t.Literal("SECTION"),
    t.Literal("ARTICLE"),
    t.Literal("CLAUSE"),
    t.Literal("POINT"),
]);

export const manualModule = new Elysia({ prefix: "/api/manual" })
    .post(
        "/documents",
        async ({ body, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const access = await resolveWorkspaceAccess(env, request, { requireAuth: true });

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const document = await createManualDocument(env.DB, access.workspaceId, {
                title: body.title,
                documentNumber: body.documentNumber,
                documentType: body.documentType,
                agency: body.agency,
                issuedAt: body.issuedAt,
                effectiveFrom: body.effectiveFrom,
            });

            set.status = 201;

            return { document };
        },
        {
            body: t.Object({
                title: t.String({ minLength: 1, maxLength: 300 }),
                documentNumber: t.String({ minLength: 1, maxLength: 100 }),
                documentType: t.Optional(t.Nullable(t.String({ maxLength: 80 }))),
                agency: t.Optional(t.Nullable(t.String({ maxLength: 160 }))),
                issuedAt: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
                effectiveFrom: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
            }),
        },
    )
    .patch(
        "/documents/:documentId",
        async ({ params, body, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const access = await resolveWorkspaceAccess(env, request, { requireAuth: true });

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const updated = await updateManualDocument(env.DB, access.workspaceId, params.documentId, body);

            if (!updated) {
                set.status = 404;

                return { message: "Không tìm thấy văn bản trong không gian làm việc" };
            }

            return { updated: true };
        },
        {
            params: t.Object({ documentId: t.String() }),
            body: t.Object({
                title: t.Optional(t.String({ minLength: 1, maxLength: 300 })),
                documentNumber: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
                documentType: t.Optional(t.Nullable(t.String({ maxLength: 80 }))),
                agency: t.Optional(t.Nullable(t.String({ maxLength: 160 }))),
                issuedAt: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
                effectiveFrom: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
            }),
        },
    )
    .delete(
        "/documents/:documentId",
        async ({ params, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const access = await resolveWorkspaceAccess(env, request, { requireAuth: true });

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const deleted = await deleteManualDocument(env.DB, access.workspaceId, params.documentId);

            if (!deleted) {
                set.status = 404;

                return { message: "Không tìm thấy văn bản" };
            }

            return { deleted: true };
        },
        {
            params: t.Object({ documentId: t.String() }),
        },
    )
    .post(
        "/documents/:documentId/provisions",
        async ({ params, body, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const access = await resolveWorkspaceAccess(env, request, { requireAuth: true });

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const provision = await insertManualProvision(env.DB, access.workspaceId, params.documentId, {
                parentId: body.parentId,
                level: body.level as ManualProvisionLevel,
                number: body.number,
                title: body.title,
                text: body.text,
            });

            if (!provision) {
                set.status = 404;

                return { message: "Không tìm thấy văn bản hoặc điều khoản cha" };
            }

            set.status = 201;

            return { provision };
        },
        {
            params: t.Object({ documentId: t.String() }),
            body: t.Object({
                parentId: t.Optional(t.Nullable(t.String())),
                level: PROVISION_LEVELS,
                number: t.String({ minLength: 1, maxLength: 40 }),
                title: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
                text: t.Optional(t.Nullable(t.String({ maxLength: 5000 }))),
            }),
        },
    )
    .patch(
        "/documents/:documentId/provisions/:provisionId",
        async ({ params, body, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const access = await resolveWorkspaceAccess(env, request, { requireAuth: true });

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const updated = await updateManualProvision(env.DB, access.workspaceId, params.documentId, params.provisionId, {
                level: body.level as ManualProvisionLevel | undefined,
                number: body.number,
                title: body.title,
                text: body.text,
            });

            if (!updated) {
                set.status = 404;

                return { message: "Không tìm thấy điều khoản" };
            }

            return { updated: true };
        },
        {
            params: t.Object({ documentId: t.String(), provisionId: t.String() }),
            body: t.Object({
                level: t.Optional(PROVISION_LEVELS),
                number: t.Optional(t.String({ minLength: 1, maxLength: 40 })),
                title: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
                text: t.Optional(t.Nullable(t.String({ maxLength: 5000 }))),
            }),
        },
    )
    .delete(
        "/documents/:documentId/provisions/:provisionId",
        async ({ params, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const access = await resolveWorkspaceAccess(env, request, { requireAuth: true });

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const deleted = await deleteManualProvision(env.DB, access.workspaceId, params.documentId, params.provisionId);

            if (!deleted) {
                set.status = 404;

                return { message: "Không tìm thấy điều khoản" };
            }

            return { deleted: true };
        },
        {
            params: t.Object({ documentId: t.String(), provisionId: t.String() }),
        },
    )
    .post(
        "/graph/document-relations",
        async ({ body, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const access = await resolveWorkspaceAccess(env, request, { requireAuth: true });

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const relation = await createManualDocumentRelation(env.DB, access.workspaceId, body);

            if (!relation) {
                set.status = 404;

                return { message: "Văn bản nguồn hoặc đích không thuộc không gian làm việc này" };
            }

            set.status = 201;

            return { relation };
        },
        {
            body: t.Object({
                fromDocumentId: t.String(),
                toDocumentId: t.String(),
                relationType: t.String({ minLength: 1, maxLength: 60 }),
                scope: t.Optional(t.String({ maxLength: 40 })),
                note: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
            }),
        },
    )
    .delete(
        "/graph/document-relations/:relationId",
        async ({ params, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const access = await resolveWorkspaceAccess(env, request, { requireAuth: true });

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const deleted = await deleteManualDocumentRelation(env.DB, access.workspaceId, params.relationId);

            if (!deleted) {
                set.status = 404;

                return { message: "Không tìm thấy quan hệ văn bản" };
            }

            return { deleted: true };
        },
        {
            params: t.Object({ relationId: t.String() }),
        },
    )
    .post(
        "/graph/provision-relations",
        async ({ body, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const access = await resolveWorkspaceAccess(env, request, { requireAuth: true });

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const relation = await createManualProvisionRelation(env.DB, access.workspaceId, body);

            if (!relation) {
                set.status = 404;

                return { message: "Văn bản nguồn hoặc đích không thuộc không gian làm việc này" };
            }

            set.status = 201;

            return { relation };
        },
        {
            body: t.Object({
                fromDocumentId: t.String(),
                fromProvisionId: t.String(),
                toDocumentId: t.String(),
                toProvisionId: t.Optional(t.Nullable(t.String())),
                relationType: t.String({ minLength: 1, maxLength: 60 }),
                evidenceText: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
                effectiveFrom: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
            }),
        },
    )
    .delete(
        "/graph/provision-relations/:relationId",
        async ({ params, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const access = await resolveWorkspaceAccess(env, request, { requireAuth: true });

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const deleted = await deleteManualProvisionRelation(env.DB, access.workspaceId, params.relationId);

            if (!deleted) {
                set.status = 404;

                return { message: "Không tìm thấy quan hệ điều khoản" };
            }

            return { deleted: true };
        },
        {
            params: t.Object({ relationId: t.String() }),
        },
    )
    .post(
        "/graph/sanction-edges",
        async ({ body, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const access = await resolveWorkspaceAccess(env, request, { requireAuth: true });

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const edge = await createManualSanctionEdge(env.DB, access.workspaceId, body);

            if (!edge) {
                set.status = 404;

                return { message: "Văn bản nguồn hoặc đích không thuộc không gian làm việc này" };
            }

            set.status = 201;

            return { edge };
        },
        {
            body: t.Object({
                fromDocumentId: t.String(),
                toDocumentId: t.String(),
                fromProvisionId: t.Optional(t.Nullable(t.String())),
                toProvisionId: t.Optional(t.Nullable(t.String())),
                behaviorSummary: t.String({ minLength: 1, maxLength: 300 }),
                changeType: t.String({ minLength: 1, maxLength: 60 }),
                oldPenaltyText: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
                newPenaltyText: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
                oldFineMin: t.Optional(t.Nullable(t.Number())),
                oldFineMax: t.Optional(t.Nullable(t.Number())),
                newFineMin: t.Optional(t.Nullable(t.Number())),
                newFineMax: t.Optional(t.Nullable(t.Number())),
                note: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
            }),
        },
    )
    .delete(
        "/graph/sanction-edges/:edgeId",
        async ({ params, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const access = await resolveWorkspaceAccess(env, request, { requireAuth: true });

            if (!access.ok) {
                set.status = access.status;

                return { message: access.message };
            }

            const deleted = await deleteManualSanctionEdge(env.DB, access.workspaceId, params.edgeId);

            if (!deleted) {
                set.status = 404;

                return { message: "Không tìm thấy cạnh biến động xử phạt" };
            }

            return { deleted: true };
        },
        {
            params: t.Object({ edgeId: t.String() }),
        },
    );
