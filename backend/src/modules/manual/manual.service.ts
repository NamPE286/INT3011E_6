import type { D1Database } from "@cloudflare/workers-types";

export type ManualProvisionLevel = "CHAPTER" | "SECTION" | "ARTICLE" | "CLAUSE" | "POINT";

export type CreateManualDocumentInput = {
    title: string;
    documentNumber: string;
    documentType?: string | null;
    agency?: string | null;
    issuedAt?: string | null;
    effectiveFrom?: string | null;
};

export type UpdateManualDocumentInput = {
    title?: string;
    documentNumber?: string | null;
    documentType?: string | null;
    agency?: string | null;
    issuedAt?: string | null;
    effectiveFrom?: string | null;
};

export type CreateManualProvisionInput = {
    parentId?: string | null;
    level: ManualProvisionLevel;
    number: string;
    title?: string | null;
    text?: string | null;
};

export type UpdateManualProvisionInput = {
    level?: ManualProvisionLevel;
    number?: string;
    title?: string | null;
    text?: string | null;
};

export type CreateManualDocumentRelationInput = {
    fromDocumentId: string;
    toDocumentId: string;
    relationType: string;
    scope?: string;
    note?: string | null;
};

export type CreateManualProvisionRelationInput = {
    fromDocumentId: string;
    fromProvisionId: string;
    toDocumentId: string;
    toProvisionId?: string | null;
    relationType: string;
    evidenceText?: string | null;
    effectiveFrom?: string | null;
};

export type CreateManualSanctionEdgeInput = {
    fromDocumentId: string;
    toDocumentId: string;
    fromProvisionId?: string | null;
    toProvisionId?: string | null;
    behaviorSummary: string;
    changeType: string;
    oldPenaltyText?: string | null;
    newPenaltyText?: string | null;
    oldFineMin?: number | null;
    oldFineMax?: number | null;
    newFineMin?: number | null;
    newFineMax?: number | null;
    note?: string | null;
};

type ParentProvisionRow = {
    id: string;
    level: string;
    number: string;
    article_no: string | null;
    paragraph_no: string | null;
    point_no: string | null;
};

function normalizeDocumentNumber(raw: string): string {
    return raw
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D")
        .toUpperCase()
        .replace(/\s+/g, " ")
        .trim();
}

async function assertDocumentInWorkspace(db: D1Database, workspaceId: string, documentId: string): Promise<boolean> {
    const row = await db
        .prepare("SELECT id FROM legal_documents WHERE id = ? AND workspace_id = ?")
        .bind(documentId, workspaceId)
        .first<{ id: string }>();

    return row !== null;
}

export async function createManualDocument(db: D1Database, workspaceId: string, input: CreateManualDocumentInput) {
    const id = `doc-man-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const title = input.title.trim();
    const documentNumber = input.documentNumber.trim();
    const normalizedNumber = normalizeDocumentNumber(documentNumber);
    const documentType = input.documentType?.trim() || "Dự thảo";
    const agency = input.agency?.trim() || null;
    const issuedAt = input.issuedAt?.trim() || now.slice(0, 10);
    const effectiveFrom = input.effectiveFrom?.trim() || null;

    const manualJobId = `manual-${id}`;

    await db
        .prepare(
            `INSERT INTO processing_jobs (
                id, workspace_id, file_key, original_filename, mime_type, file_size,
                status, step, progress, created_at, updated_at, completed_at
            ) VALUES (?, ?, ?, ?, 'application/json', 0, 'completed', 'manual', 100, ?, ?, ?)`,
        )
        .bind(manualJobId, workspaceId, `manual/${id}.json`, `${documentNumber}.json`, now, now, now)
        .run();

    await db
        .prepare(
            `INSERT INTO legal_documents (
                id, workspace_id, job_id, document_title, json_content, snapshot_r2_key, artifact_r2_key,
                pdf_sha256, review_status, validation_issues, page_count, extraction_model, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACCEPTED', '[]', 1, 'MANUAL', ?)`,
        )
        .bind(
            id,
            workspaceId,
            manualJobId,
            title,
            JSON.stringify({ document_title: title, articles: [] }),
            `manual/${id}.json`,
            `manual/${id}.json`,
            `manual-${id}`,
            now,
        )
        .run();

    await db
        .prepare(
            `INSERT INTO document_metadata (
                document_id, document_number, normalized_number, document_type, agency, issued_at, effective_from, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, documentNumber, normalizedNumber, documentType, agency, issuedAt, effectiveFrom, now)
        .run();

    return {
        id,
        workspaceId,
        title,
        documentNumber,
        documentType,
        agency,
        issuedAt,
        effectiveFrom,
        createdAt: now,
    };
}

export async function updateManualDocument(
    db: D1Database,
    workspaceId: string,
    documentId: string,
    input: UpdateManualDocumentInput,
): Promise<boolean> {
    if (!(await assertDocumentInWorkspace(db, workspaceId, documentId))) {
        return false;
    }

    const now = new Date().toISOString();

    if (input.title !== undefined) {
        await db
            .prepare("UPDATE legal_documents SET document_title = ? WHERE id = ? AND workspace_id = ?")
            .bind(input.title.trim(), documentId, workspaceId)
            .run();
    }

    const existingMeta = await db
        .prepare("SELECT document_number, document_type, agency, issued_at, effective_from FROM document_metadata WHERE document_id = ?")
        .bind(documentId)
        .first<{
            document_number: string | null;
            document_type: string | null;
            agency: string | null;
            issued_at: string | null;
            effective_from: string | null;
        }>();

    const nextNumber = input.documentNumber !== undefined ? input.documentNumber?.trim() || null : existingMeta?.document_number ?? null;
    const nextNormalized = nextNumber ? normalizeDocumentNumber(nextNumber) : null;
    const nextType = input.documentType !== undefined ? input.documentType?.trim() || null : existingMeta?.document_type ?? null;
    const nextAgency = input.agency !== undefined ? input.agency?.trim() || null : existingMeta?.agency ?? null;
    const nextIssuedAt = input.issuedAt !== undefined ? input.issuedAt?.trim() || null : existingMeta?.issued_at ?? null;
    const nextEffective = input.effectiveFrom !== undefined ? input.effectiveFrom?.trim() || null : existingMeta?.effective_from ?? null;

    if (existingMeta) {
        await db
            .prepare(
                `UPDATE document_metadata
                 SET document_number = ?, normalized_number = ?, document_type = ?, agency = ?, issued_at = ?, effective_from = ?, updated_at = ?
                 WHERE document_id = ?`,
            )
            .bind(nextNumber, nextNormalized, nextType, nextAgency, nextIssuedAt, nextEffective, now, documentId)
            .run();
    } else {
        await db
            .prepare(
                `INSERT INTO document_metadata (
                    document_id, document_number, normalized_number, document_type, agency, issued_at, effective_from, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(documentId, nextNumber, nextNormalized, nextType, nextAgency, nextIssuedAt, nextEffective, now)
            .run();
    }

    return true;
}

export async function deleteManualDocument(db: D1Database, workspaceId: string, documentId: string): Promise<boolean> {
    if (!(await assertDocumentInWorkspace(db, workspaceId, documentId))) {
        return false;
    }

    await db
        .prepare("DELETE FROM sanction_change_edges WHERE workspace_id = ? AND (from_document_id = ? OR to_document_id = ?)")
        .bind(workspaceId, documentId, documentId)
        .run();
    await db
        .prepare("DELETE FROM provision_relations WHERE workspace_id = ? AND (from_document_id = ? OR to_document_id = ?)")
        .bind(workspaceId, documentId, documentId)
        .run();
    await db
        .prepare("DELETE FROM document_relations WHERE workspace_id = ? AND (from_document_id = ? OR to_document_id = ?)")
        .bind(workspaceId, documentId, documentId)
        .run();
    await db.prepare("DELETE FROM provisions WHERE document_id = ?").bind(documentId).run();
    await db.prepare("DELETE FROM legal_documents WHERE id = ? AND workspace_id = ?").bind(documentId, workspaceId).run();

    return true;
}

export async function insertManualProvision(
    db: D1Database,
    workspaceId: string,
    documentId: string,
    input: CreateManualProvisionInput,
) {
    if (!(await assertDocumentInWorkspace(db, workspaceId, documentId))) {
        return null;
    }

    const parentId = input.parentId?.trim() || null;
    let parentRow: ParentProvisionRow | null = null;

    if (parentId) {
        parentRow = await db
            .prepare("SELECT id, level, number, article_no, paragraph_no, point_no FROM provisions WHERE id = ? AND document_id = ?")
            .bind(parentId, documentId)
            .first<ParentProvisionRow>();

        if (!parentRow) {
            return null;
        }
    }

    const maxOrdinalRow = await db
        .prepare("SELECT COALESCE(MAX(ordinal), 0) AS max_ord FROM provisions WHERE document_id = ?")
        .bind(documentId)
        .first<{ max_ord: number }>();

    const ordinal = Number(maxOrdinalRow?.max_ord ?? 0) + 1;
    const id = `${documentId}:man-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const num = input.number.trim();

    let articleNo = parentRow?.article_no ?? null;
    let paragraphNo = parentRow?.paragraph_no ?? null;
    let pointNo = parentRow?.point_no ?? null;

    if (input.level === "ARTICLE") {
        articleNo = num;
        paragraphNo = null;
        pointNo = null;
    } else if (input.level === "CLAUSE") {
        paragraphNo = num;
        pointNo = null;
    } else if (input.level === "POINT") {
        pointNo = num;
    }

    await db
        .prepare(
            `INSERT INTO provisions (
                id, document_id, parent_id, ordinal, level, number, title, text,
                article_no, paragraph_no, point_no, content_role, relevance, role_method, role_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NORM', 'CORE', 'MANUAL', '1.0', ?)`,
        )
        .bind(
            id,
            documentId,
            parentId,
            ordinal,
            input.level,
            num,
            input.title?.trim() || null,
            input.text?.trim() || null,
            articleNo,
            paragraphNo,
            pointNo,
            now,
        )
        .run();

    return {
        id,
        documentId,
        parentId,
        ordinal,
        level: input.level,
        number: num,
        title: input.title?.trim() || null,
        text: input.text?.trim() || null,
        articleNo,
        paragraphNo,
        pointNo,
    };
}

export async function updateManualProvision(
    db: D1Database,
    workspaceId: string,
    documentId: string,
    provisionId: string,
    input: UpdateManualProvisionInput,
): Promise<boolean> {
    if (!(await assertDocumentInWorkspace(db, workspaceId, documentId))) {
        return false;
    }

    const existing = await db
        .prepare("SELECT id, level, number, title, text, article_no, paragraph_no, point_no FROM provisions WHERE id = ? AND document_id = ?")
        .bind(provisionId, documentId)
        .first<{
            id: string;
            level: string;
            number: string;
            title: string | null;
            text: string | null;
            article_no: string | null;
            paragraph_no: string | null;
            point_no: string | null;
        }>();

    if (!existing) {
        return false;
    }

    const nextLevel = input.level ?? existing.level;
    const nextNumber = input.number?.trim() || existing.number;
    const nextTitle = input.title !== undefined ? input.title?.trim() || null : existing.title;
    const nextText = input.text !== undefined ? input.text?.trim() || null : existing.text;

    const nextArticleNo = nextLevel === "ARTICLE" ? nextNumber : existing.article_no;
    const nextParagraphNo = nextLevel === "CLAUSE" ? nextNumber : existing.paragraph_no;
    const nextPointNo = nextLevel === "POINT" ? nextNumber : existing.point_no;

    await db
        .prepare(
            `UPDATE provisions
             SET level = ?, number = ?, title = ?, text = ?, article_no = ?, paragraph_no = ?, point_no = ?
             WHERE id = ? AND document_id = ?`,
        )
        .bind(nextLevel, nextNumber, nextTitle, nextText, nextArticleNo, nextParagraphNo, nextPointNo, provisionId, documentId)
        .run();

    return true;
}

export async function deleteManualProvision(
    db: D1Database,
    workspaceId: string,
    documentId: string,
    provisionId: string,
): Promise<boolean> {
    if (!(await assertDocumentInWorkspace(db, workspaceId, documentId))) {
        return false;
    }

    const allProvisions = await db
        .prepare("SELECT id, parent_id FROM provisions WHERE document_id = ?")
        .bind(documentId)
        .all<{ id: string; parent_id: string | null }>();

    const toDelete = new Set<string>([provisionId]);
    let changed = true;

    while (changed) {
        changed = false;

        for (const row of allProvisions.results) {
            if (row.parent_id && toDelete.has(row.parent_id) && !toDelete.has(row.id)) {
                toDelete.add(row.id);
                changed = true;
            }
        }
    }

    for (const id of toDelete) {
        await db.prepare("DELETE FROM provisions WHERE id = ? AND document_id = ?").bind(id, documentId).run();
    }

    return true;
}

export async function createManualDocumentRelation(
    db: D1Database,
    workspaceId: string,
    input: CreateManualDocumentRelationInput,
) {
    const [fromExists, toExists] = await Promise.all([
        assertDocumentInWorkspace(db, workspaceId, input.fromDocumentId),
        assertDocumentInWorkspace(db, workspaceId, input.toDocumentId),
    ]);

    if (!fromExists || !toExists) {
        return null;
    }

    const id = `dr-man-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const scope = input.scope?.trim() || "PARTIAL";
    const note = input.note?.trim() || null;

    await db
        .prepare(
            `INSERT INTO document_relations (
                id, workspace_id, from_document_id, to_document_id, relation_type, scope,
                verification_status, evidence_level, method, source_mode, note, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'ACCEPTED', 'MANUAL', 'MANUAL', 'MANUAL', ?, ?)`,
        )
        .bind(id, workspaceId, input.fromDocumentId, input.toDocumentId, input.relationType, scope, note, now)
        .run();

    return {
        id,
        fromDocumentId: input.fromDocumentId,
        toDocumentId: input.toDocumentId,
        relationType: input.relationType,
        scope,
        verificationStatus: "ACCEPTED",
        evidenceLevel: "MANUAL",
        sourceMode: "MANUAL" as const,
        note,
    };
}

export async function deleteManualDocumentRelation(db: D1Database, workspaceId: string, relationId: string): Promise<boolean> {
    const existing = await db
        .prepare("SELECT id FROM document_relations WHERE id = ? AND workspace_id = ?")
        .bind(relationId, workspaceId)
        .first<{ id: string }>();

    if (!existing) {
        return false;
    }

    await db.prepare("DELETE FROM document_relations WHERE id = ? AND workspace_id = ?").bind(relationId, workspaceId).run();

    return true;
}

export async function createManualProvisionRelation(
    db: D1Database,
    workspaceId: string,
    input: CreateManualProvisionRelationInput,
) {
    const [fromExists, toExists] = await Promise.all([
        assertDocumentInWorkspace(db, workspaceId, input.fromDocumentId),
        assertDocumentInWorkspace(db, workspaceId, input.toDocumentId),
    ]);

    if (!fromExists || !toExists) {
        return null;
    }

    const id = `pr-man-${crypto.randomUUID().slice(0, 12)}`;
    const ciId = `ci-man-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const evidenceText = input.evidenceText?.trim() || "Quan hệ điều khoản được nối thủ công bởi nhà soạn luật.";
    const toProvisionId = input.toProvisionId?.trim() || null;

    await db
        .prepare(
            `INSERT INTO change_instructions (
                id, source_document_id, source_provision_id, operation, raw_text, raw_target_citation,
                target_document_id, target_scope, resolution_status, resolution_reason, method, extractor_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PROVISION', 'RESOLVED', 'manual', 'MANUAL', '1.0', ?)`,
        )
        .bind(ciId, input.fromDocumentId, input.fromProvisionId, input.relationType, evidenceText, toProvisionId ?? input.toDocumentId, input.toDocumentId, now)
        .run();

    await db
        .prepare(
            `INSERT INTO provision_relations (
                id, workspace_id, change_instruction_id, from_document_id, from_provision_id,
                to_document_id, to_provision_id, relation_type, target_locator, verification_status,
                evidence_level, evidence_text, effective_from, method, extractor_version, source_mode, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACCEPTED', 'MANUAL', ?, ?, 'MANUAL', '1.0', 'MANUAL', ?)`,
        )
        .bind(
            id,
            workspaceId,
            ciId,
            input.fromDocumentId,
            input.fromProvisionId,
            input.toDocumentId,
            toProvisionId,
            input.relationType,
            toProvisionId ?? "DOCUMENT",
            evidenceText,
            input.effectiveFrom?.trim() || null,
            now,
        )
        .run();

    return {
        id,
        fromDocumentId: input.fromDocumentId,
        fromProvisionId: input.fromProvisionId,
        toDocumentId: input.toDocumentId,
        toProvisionId,
        relationType: input.relationType,
        verificationStatus: "ACCEPTED",
        evidenceText,
        effectiveFrom: input.effectiveFrom?.trim() || null,
        sourceMode: "MANUAL" as const,
    };
}

export async function deleteManualProvisionRelation(db: D1Database, workspaceId: string, relationId: string): Promise<boolean> {
    const existing = await db
        .prepare("SELECT id FROM provision_relations WHERE id = ? AND workspace_id = ?")
        .bind(relationId, workspaceId)
        .first<{ id: string }>();

    if (!existing) {
        return false;
    }

    await db.prepare("DELETE FROM provision_relations WHERE id = ? AND workspace_id = ?").bind(relationId, workspaceId).run();

    return true;
}

export async function createManualSanctionEdge(
    db: D1Database,
    workspaceId: string,
    input: CreateManualSanctionEdgeInput,
) {
    const [fromExists, toExists] = await Promise.all([
        assertDocumentInWorkspace(db, workspaceId, input.fromDocumentId),
        assertDocumentInWorkspace(db, workspaceId, input.toDocumentId),
    ]);

    if (!fromExists || !toExists) {
        return null;
    }

    const id = `sc-man-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    await db
        .prepare(
            `INSERT INTO sanction_change_edges (
                id, workspace_id, from_document_id, to_document_id, from_provision_id, to_provision_id,
                behavior_summary, change_type, old_penalty_text, new_penalty_text,
                old_fine_min, old_fine_max, new_fine_min, new_fine_max, note, source_mode, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?)`,
        )
        .bind(
            id,
            workspaceId,
            input.fromDocumentId,
            input.toDocumentId,
            input.fromProvisionId?.trim() || null,
            input.toProvisionId?.trim() || null,
            input.behaviorSummary.trim(),
            input.changeType,
            input.oldPenaltyText?.trim() || null,
            input.newPenaltyText?.trim() || null,
            input.oldFineMin ?? null,
            input.oldFineMax ?? null,
            input.newFineMin ?? null,
            input.newFineMax ?? null,
            input.note?.trim() || null,
            now,
        )
        .run();

    return {
        id,
        fromDocumentId: input.fromDocumentId,
        toDocumentId: input.toDocumentId,
        fromProvisionId: input.fromProvisionId?.trim() || null,
        toProvisionId: input.toProvisionId?.trim() || null,
        behaviorSummary: input.behaviorSummary.trim(),
        changeType: input.changeType,
        oldPenaltyText: input.oldPenaltyText?.trim() || null,
        newPenaltyText: input.newPenaltyText?.trim() || null,
        oldFineMin: input.oldFineMin ?? null,
        oldFineMax: input.oldFineMax ?? null,
        newFineMin: input.newFineMin ?? null,
        newFineMax: input.newFineMax ?? null,
        note: input.note?.trim() || null,
        sourceMode: "MANUAL" as const,
    };
}

export async function deleteManualSanctionEdge(db: D1Database, workspaceId: string, edgeId: string): Promise<boolean> {
    const existing = await db
        .prepare("SELECT id FROM sanction_change_edges WHERE id = ? AND workspace_id = ?")
        .bind(edgeId, workspaceId)
        .first<{ id: string }>();

    if (!existing) {
        return false;
    }

    await db.prepare("DELETE FROM sanction_change_edges WHERE id = ? AND workspace_id = ?").bind(edgeId, workspaceId).run();

    return true;
}
