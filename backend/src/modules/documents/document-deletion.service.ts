import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { refreshChanges } from "../changes/change.service";
import { refreshHistory } from "../history/history.service";

export type DependentDocument = {
    documentId: string;
    documentNumber: string | null;
    title: string | null;
};

export type DocumentDeletionOutcome =
    | { outcome: "DELETED"; documentId: string; jobId: string; storageError: string | null }
    | { outcome: "NOT_FOUND" }
    | { outcome: "HAS_DEPENDENTS"; dependents: DependentDocument[] };

type DocumentRow = {
    id: string;
    job_id: string;
    snapshot_r2_key: string | null;
    artifact_r2_key: string | null;
    file_key: string | null;
};

type DependentRow = {
    id: string;
    document_number: string | null;
    document_title: string | null;
};

/**
 * Documents that act on this one (amend, supplement, replace, repeal …). A document with none is a leaf of
 * the relation graph: removing it cannot leave another document's edge pointing at nothing.
 */
export async function listDependentDocuments(db: D1Database, documentId: string): Promise<DependentDocument[]> {
    const rows = await db
        .prepare(
            `SELECT d.id, m.document_number, d.document_title
             FROM (
                 SELECT from_document_id AS id FROM document_relations WHERE to_document_id = ?1 AND from_document_id != ?1
                 UNION
                 SELECT from_document_id AS id FROM provision_relations WHERE to_document_id = ?1 AND from_document_id != ?1
             ) AS dependent
             JOIN legal_documents d ON d.id = dependent.id
             LEFT JOIN document_metadata m ON m.document_id = d.id
             ORDER BY m.document_number, d.id`
        )
        .bind(documentId)
        .all<DependentRow>();

    return rows.results.map((row) => ({ documentId: row.id, documentNumber: row.document_number, title: row.document_title }));
}

/**
 * Deletes a leaf document with everything read from it: provisions, metadata, its relations to other
 * documents, change instructions, rules, identities, its job and stored files. The corpus-wide change
 * graph, document graph and history are then rebuilt, so citations of the deleted document fall back to
 * unresolved candidates and violations no rule refers to any more disappear.
 */
export async function deleteLeafDocument(db: D1Database, storage: R2Bucket | undefined, documentId: string): Promise<DocumentDeletionOutcome> {
    const document = await db
        .prepare(
            `SELECT d.id, d.job_id, d.snapshot_r2_key, d.artifact_r2_key, j.file_key
             FROM legal_documents d LEFT JOIN processing_jobs j ON j.id = d.job_id
             WHERE d.id = ?`
        )
        .bind(documentId)
        .first<DocumentRow>();

    if (!document) {
        return { outcome: "NOT_FOUND" };
    }

    const dependents = await listDependentDocuments(db, documentId);

    if (dependents.length > 0) {
        return { outcome: "HAS_DEPENDENTS", dependents };
    }

    await deleteDocumentRows(db, documentId, document.job_id);
    await refreshChanges(db);
    await refreshHistory(db);

    const storageError = await deleteStoredFiles(storage, document);

    return { outcome: "DELETED", documentId, jobId: document.job_id, storageError };
}

async function deleteDocumentRows(db: D1Database, documentId: string, jobId: string): Promise<void> {
    const rulesOfDocument = "SELECT id FROM violation_rules WHERE source_document_id = ?";

    await db.batch([
        db.prepare("DELETE FROM provision_relations WHERE from_document_id = ?").bind(documentId),
        db.prepare("DELETE FROM change_instructions WHERE source_document_id = ?").bind(documentId),
        db.prepare("DELETE FROM document_relations WHERE from_document_id = ?1 OR to_document_id = ?1").bind(documentId),
        db.prepare("DELETE FROM document_relation_candidates WHERE source_document_id = ?").bind(documentId),
        db.prepare("DELETE FROM violation_aliases WHERE source_document_id = ?").bind(documentId),
        db.prepare("DELETE FROM identity_decisions WHERE source_document_id = ?").bind(documentId),
        db.prepare(`DELETE FROM sanction_effects WHERE sanction_id IN (SELECT id FROM sanctions WHERE violation_rule_id IN (${rulesOfDocument}))`).bind(documentId),
        db.prepare(`DELETE FROM sanctions WHERE violation_rule_id IN (${rulesOfDocument})`).bind(documentId),
        db.prepare("DELETE FROM violation_rules WHERE source_document_id = ?").bind(documentId),
        db.prepare("DELETE FROM extraction_runs WHERE document_id = ?").bind(documentId),
        db.prepare("DELETE FROM provisions WHERE document_id = ?").bind(documentId),
        db.prepare("DELETE FROM document_metadata WHERE document_id = ?").bind(documentId),
        db.prepare("DELETE FROM legal_documents WHERE id = ?").bind(documentId),
        db.prepare("DELETE FROM preprocessing_stages WHERE job_id = ?").bind(jobId),
        db.prepare("DELETE FROM processing_jobs WHERE id = ?").bind(jobId),
        db.prepare(
            `DELETE FROM violation_aliases WHERE traffic_violation_id NOT IN (
                SELECT traffic_violation_id FROM violation_rules WHERE traffic_violation_id IS NOT NULL
            )`
        ),
        db.prepare(
            `DELETE FROM traffic_violations WHERE id NOT IN (
                SELECT traffic_violation_id FROM violation_rules WHERE traffic_violation_id IS NOT NULL
            )`
        ),
    ]);
}

/** The uploaded PDF, its snapshot and every read artifact of the job. A storage failure leaves the database deletion in place. */
async function deleteStoredFiles(storage: R2Bucket | undefined, document: DocumentRow): Promise<string | null> {
    if (!storage) {
        return "File storage is unavailable; stored files were not removed.";
    }

    try {
        const keys = [document.file_key, document.snapshot_r2_key, document.artifact_r2_key];
        let cursor: string | undefined;

        do {
            const page = await storage.list({ prefix: `runs/${document.job_id}/`, cursor });

            keys.push(...page.objects.map((object) => object.key));
            cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);

        const uniqueKeys = [...new Set(keys.filter((key): key is string => typeof key === "string" && key.length > 0))];

        if (uniqueKeys.length > 0) {
            await storage.delete(uniqueKeys);
        }

        return null;
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";

        console.error(`[documents] Stored files of ${document.id} could not be removed: ${message}`);

        return "Stored files could not be removed.";
    }
}
