import type { D1Database } from "@cloudflare/workers-types";
import type { DraftDocument } from "./ide.types";

type DraftRow = {
    id: string;
    title: string;
    document_number: string | null;
    document_type: string | null;
    agency: string | null;
    content: string;
    source_document_id: string | null;
    created_at: string;
    updated_at: string;
};

export type CreateDraftInput = {
    id: string;
    title: string;
    documentNumber: string | null;
    documentType: string | null;
    agency: string | null;
    content: string;
    sourceDocumentId: string | null;
};

export type UpdateDraftInput = {
    title?: string;
    documentNumber?: string | null;
    documentType?: string | null;
    agency?: string | null;
    content?: string;
};

export async function listSavedDrafts(db: D1Database): Promise<DraftDocument[]> {
    const result = await db
        .prepare(
            `SELECT id, title, document_number, document_type, agency, content, source_document_id, created_at, updated_at
             FROM draft_documents
             ORDER BY updated_at DESC
             LIMIT 100`,
        )
        .all<DraftRow>();

    return result.results.map(mapRow);
}

export async function findSavedDraft(db: D1Database, id: string): Promise<DraftDocument | null> {
    const row = await db
        .prepare(
            `SELECT id, title, document_number, document_type, agency, content, source_document_id, created_at, updated_at
             FROM draft_documents
             WHERE id = ?`,
        )
        .bind(id)
        .first<DraftRow>();

    return row ? mapRow(row) : null;
}

export async function insertSavedDraft(db: D1Database, input: CreateDraftInput): Promise<DraftDocument> {
    const now = new Date().toISOString();

    await db
        .prepare(
            `INSERT INTO draft_documents (
                id, title, document_number, document_type, agency, content, source_document_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            input.id,
            input.title,
            input.documentNumber,
            input.documentType,
            input.agency,
            input.content,
            input.sourceDocumentId,
            now,
            now,
        )
        .run();

    return {
        id: input.id,
        title: input.title,
        documentNumber: input.documentNumber,
        documentType: input.documentType,
        agency: input.agency,
        content: input.content,
        sourceDocumentId: input.sourceDocumentId,
        isTemplate: false,
        createdAt: now,
        updatedAt: now,
    };
}

export async function updateSavedDraft(db: D1Database, id: string, input: UpdateDraftInput): Promise<DraftDocument | null> {
    const existing = await findSavedDraft(db, id);

    if (!existing) {
        return null;
    }

    const now = new Date().toISOString();
    const title = input.title ?? existing.title;
    const documentNumber = input.documentNumber !== undefined ? input.documentNumber : existing.documentNumber;
    const documentType = input.documentType !== undefined ? input.documentType : existing.documentType;
    const agency = input.agency !== undefined ? input.agency : existing.agency;
    const content = input.content ?? existing.content;

    await db
        .prepare(
            `UPDATE draft_documents
             SET title = ?, document_number = ?, document_type = ?, agency = ?, content = ?, updated_at = ?
             WHERE id = ?`,
        )
        .bind(title, documentNumber, documentType, agency, content, now, id)
        .run();

    return {
        ...existing,
        title,
        documentNumber,
        documentType,
        agency,
        content,
        updatedAt: now,
    };
}

export async function deleteSavedDraft(db: D1Database, id: string): Promise<boolean> {
    const info = await db.prepare("DELETE FROM draft_documents WHERE id = ?").bind(id).run();

    return (info.meta.changes ?? 0) > 0;
}

function mapRow(row: DraftRow): DraftDocument {
    return {
        id: row.id,
        title: row.title,
        documentNumber: row.document_number,
        documentType: row.document_type,
        agency: row.agency,
        content: row.content,
        sourceDocumentId: row.source_document_id,
        isTemplate: false,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
