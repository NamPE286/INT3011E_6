import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { ProvisionLocator } from "./change.locator";
import {
    CHANGE_EXTRACTOR_VERSION,
    CHANGE_METHOD,
    type ChangeInstruction,
    type ChangeOperation,
    type InstructionStatus,
    type ProvisionRelation,
    type ProvisionRelationType,
    type RelationVerification,
    type TargetScope,
} from "./change.types";

type InstructionRow = {
    id: string;
    source_document_id: string;
    source_provision_id: string;
    source_snapshot_id: string | null;
    operation: ChangeOperation;
    raw_text: string;
    raw_target_citation: string;
    target_document_citation: string | null;
    target_document_number: string | null;
    target_is_self: number;
    target_document_id: string | null;
    target_scope: TargetScope;
    target_locators: string;
    new_text_provision_ids: string;
    quoted_segments: string;
    exceptions: string;
    effective_from: string | null;
    resolution_status: InstructionStatus;
    resolution_reason: string;
};

type RelationRow = {
    id: string;
    change_instruction_id: string;
    from_document_id: string;
    from_provision_id: string;
    to_document_id: string;
    to_provision_id: string | null;
    relation_type: ProvisionRelationType;
    target_locator: string;
    insertion_locator: string | null;
    new_text_provision_ids: string;
    verification_status: RelationVerification;
    evidence_level: "EXPLICIT_LEGAL_TEXT";
    evidence_text: string;
    effective_from: string | null;
    method: string;
    extractor_version: string;
};

export async function replaceChangeInstructions(db: D1Database, documentId: string, instructions: ChangeInstruction[]): Promise<void> {
    const createdAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
        db.prepare("DELETE FROM change_instructions WHERE source_document_id = ?").bind(documentId),
    ];

    for (const instruction of instructions) {
        statements.push(insertInstruction(db, instruction, createdAt));
    }

    await db.batch(statements);
}

export async function deleteChangeInstructions(db: D1Database, documentId: string): Promise<void> {
    await db.prepare("DELETE FROM change_instructions WHERE source_document_id = ?").bind(documentId).run();
}

export async function listAllChangeInstructions(db: D1Database): Promise<ChangeInstruction[]> {
    const result = await db.prepare("SELECT * FROM change_instructions ORDER BY source_document_id, id").all<InstructionRow>();

    return result.results.map(toInstruction);
}

export async function listChangeInstructionsFrom(db: D1Database, documentId: string): Promise<ChangeInstruction[]> {
    const result = await db
        .prepare("SELECT * FROM change_instructions WHERE source_document_id = ? ORDER BY id")
        .bind(documentId)
        .all<InstructionRow>();

    return result.results.map(toInstruction);
}

export async function listChangeInstructionsByIds(db: D1Database, ids: string[]): Promise<ChangeInstruction[]> {
    if (ids.length === 0) {
        return [];
    }

    const result = await db
        .prepare("SELECT * FROM change_instructions WHERE id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(ids))
        .all<InstructionRow>();

    return result.results.map(toInstruction);
}

/** Rewrites resolution results of every instruction and the whole provision-relation table in one batch. */
export async function saveResolvedChanges(db: D1Database, instructions: ChangeInstruction[], relations: ProvisionRelation[]): Promise<void> {
    const createdAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [db.prepare("DELETE FROM provision_relations")];

    for (const instruction of instructions) {
        statements.push(
            db
                .prepare(
                    `UPDATE change_instructions
                     SET target_document_id = ?, effective_from = ?, resolution_status = ?, resolution_reason = ?
                     WHERE id = ?`
                )
                .bind(instruction.targetDocumentId, instruction.effectiveFrom, instruction.resolutionStatus, instruction.resolutionReason, instruction.id),
        );
    }

    for (const relation of relations) {
        statements.push(
            db.prepare(
                `INSERT INTO provision_relations (
                    id, change_instruction_id, from_document_id, from_provision_id, to_document_id, to_provision_id,
                    relation_type, target_locator, insertion_locator, new_text_provision_ids, verification_status,
                    evidence_level, evidence_text, effective_from, method, extractor_version, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                relation.id,
                relation.changeInstructionId,
                relation.fromDocumentId,
                relation.fromProvisionId,
                relation.toDocumentId,
                relation.toProvisionId,
                relation.relationType,
                JSON.stringify(relation.targetLocator),
                relation.insertionLocator ? JSON.stringify(relation.insertionLocator) : null,
                JSON.stringify(relation.newTextProvisionIds),
                relation.verificationStatus,
                relation.evidenceLevel,
                relation.evidenceText,
                relation.effectiveFrom,
                relation.method,
                relation.extractorVersion,
                createdAt,
            ),
        );
    }

    await db.batch(statements);
}

export async function listAllProvisionRelations(db: D1Database): Promise<ProvisionRelation[]> {
    const result = await db.prepare("SELECT * FROM provision_relations ORDER BY id").all<RelationRow>();

    return result.results.map(toRelation);
}

export async function listProvisionRelationsTouching(db: D1Database, provisionId: string): Promise<ProvisionRelation[]> {
    const result = await db
        .prepare("SELECT * FROM provision_relations WHERE from_provision_id = ? OR to_provision_id = ? ORDER BY id")
        .bind(provisionId, provisionId)
        .all<RelationRow>();

    return result.results.map(toRelation);
}

export async function listProvisionRelationsTo(db: D1Database, documentId: string): Promise<ProvisionRelation[]> {
    const result = await db
        .prepare("SELECT * FROM provision_relations WHERE to_document_id = ? AND from_document_id != to_document_id ORDER BY id")
        .bind(documentId)
        .all<RelationRow>();

    return result.results.map(toRelation);
}

export async function listProvisionRelationsFrom(db: D1Database, documentId: string): Promise<ProvisionRelation[]> {
    const result = await db
        .prepare("SELECT * FROM provision_relations WHERE from_document_id = ? ORDER BY id")
        .bind(documentId)
        .all<RelationRow>();

    return result.results.map(toRelation);
}

export async function listProvisionRelationsByIds(db: D1Database, ids: string[]): Promise<ProvisionRelation[]> {
    if (ids.length === 0) {
        return [];
    }

    const result = await db
        .prepare("SELECT * FROM provision_relations WHERE id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(ids))
        .all<RelationRow>();

    return result.results.map(toRelation);
}

export async function listProvisionIdsOf(db: D1Database, documentIds: string[]): Promise<Map<string, Set<string>>> {
    const byDocument = new Map<string, Set<string>>();

    if (documentIds.length === 0) {
        return byDocument;
    }

    const result = await db
        .prepare("SELECT id, document_id FROM provisions WHERE document_id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(documentIds))
        .all<{ id: string; document_id: string }>();

    for (const row of result.results) {
        const ids = byDocument.get(row.document_id) ?? new Set<string>();

        ids.add(row.id);
        byDocument.set(row.document_id, ids);
    }

    return byDocument;
}

function insertInstruction(db: D1Database, instruction: ChangeInstruction, createdAt: string): D1PreparedStatement {
    return db.prepare(
        `INSERT INTO change_instructions (
            id, source_document_id, source_provision_id, source_snapshot_id, operation, raw_text, raw_target_citation,
            target_document_citation, target_document_number, target_is_self, target_document_id, target_scope,
            target_locators, new_text_provision_ids, quoted_segments, exceptions, effective_from, resolution_status,
            resolution_reason, method, extractor_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        instruction.id,
        instruction.sourceDocumentId,
        instruction.sourceProvisionId,
        instruction.sourceSnapshotId,
        instruction.operation,
        instruction.rawText,
        instruction.rawTargetCitation,
        instruction.targetDocumentCitation,
        instruction.targetDocumentNumber,
        instruction.targetIsSelf ? 1 : 0,
        instruction.targetDocumentId,
        instruction.targetScope,
        JSON.stringify(instruction.targetLocators),
        JSON.stringify(instruction.newTextProvisionIds),
        JSON.stringify(instruction.quotedSegments),
        JSON.stringify(instruction.exceptions),
        instruction.effectiveFrom,
        instruction.resolutionStatus,
        instruction.resolutionReason,
        CHANGE_METHOD,
        CHANGE_EXTRACTOR_VERSION,
        createdAt,
    );
}

function toInstruction(row: InstructionRow): ChangeInstruction {
    return {
        id: row.id,
        sourceDocumentId: row.source_document_id,
        sourceProvisionId: row.source_provision_id,
        sourceSnapshotId: row.source_snapshot_id,
        operation: row.operation,
        rawText: row.raw_text,
        rawTargetCitation: row.raw_target_citation,
        targetDocumentCitation: row.target_document_citation,
        targetDocumentNumber: row.target_document_number,
        targetIsSelf: row.target_is_self === 1,
        targetDocumentId: row.target_document_id,
        targetScope: row.target_scope,
        targetLocators: JSON.parse(row.target_locators) as ProvisionLocator[],
        newTextProvisionIds: JSON.parse(row.new_text_provision_ids),
        quotedSegments: JSON.parse(row.quoted_segments),
        exceptions: JSON.parse(row.exceptions),
        effectiveFrom: row.effective_from,
        resolutionStatus: row.resolution_status,
        resolutionReason: row.resolution_reason,
    };
}

function toRelation(row: RelationRow): ProvisionRelation {
    return {
        id: row.id,
        changeInstructionId: row.change_instruction_id,
        fromDocumentId: row.from_document_id,
        fromProvisionId: row.from_provision_id,
        toDocumentId: row.to_document_id,
        toProvisionId: row.to_provision_id,
        relationType: row.relation_type,
        targetLocator: JSON.parse(row.target_locator) as ProvisionLocator,
        insertionLocator: row.insertion_locator ? (JSON.parse(row.insertion_locator) as ProvisionLocator) : null,
        newTextProvisionIds: JSON.parse(row.new_text_provision_ids),
        verificationStatus: row.verification_status,
        evidenceLevel: row.evidence_level,
        evidenceText: row.evidence_text,
        effectiveFrom: row.effective_from,
        method: row.method,
        extractorVersion: row.extractor_version,
    };
}
