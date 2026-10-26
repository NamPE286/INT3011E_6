import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
    ROLE_METHOD,
    ROLE_VERSION,
    type ContentRole,
    type Provision,
    type ProvisionFlag,
    type ProvisionLevel,
    type ProvisionSource,
    type Relevance,
} from "./provision.types";
import type { SourceRegion } from "../processing/legal-types";

// Rows go in as JSON through json_each so a large document needs a handful of statements,
// not one bound-parameter list per row (D1 allows only 100 bound parameters per statement).
const INSERT_CHUNK_SIZE = 200;

export type StoredProvision = {
    id: string;
    documentId: string;
    parentId: string | null;
    ordinal: number;
    level: ProvisionLevel;
    number: string;
    title: string | null;
    text: string | null;
    articleNo: string | null;
    paragraphNo: string | null;
    pointNo: string | null;
    pageStart: number | null;
    pageEnd: number | null;
    sourceQuote: string | null;
    readQuality: string | null;
    sourceSnapshotId: string | null;
    pdfSha256: string | null;
    readMethod: string | null;
    sourceRegions: SourceRegion[];
    contentRole: ContentRole;
    relevance: Relevance;
    containerProvisionId: string | null;
    quotedSegments: string[];
    flags: ProvisionFlag[];
    roleMethod: string;
    roleVersion: string;
};

type ProvisionRow = {
    id: string;
    document_id: string;
    parent_id: string | null;
    ordinal: number;
    level: ProvisionLevel;
    number: string;
    title: string | null;
    text: string | null;
    article_no: string | null;
    paragraph_no: string | null;
    point_no: string | null;
    page_start: number | null;
    page_end: number | null;
    source_quote: string | null;
    read_quality: string | null;
    source_snapshot_id: string | null;
    pdf_sha256: string | null;
    read_method: string | null;
    source_regions: string;
    content_role: ContentRole;
    relevance: Relevance;
    container_provision_id: string | null;
    quoted_segments: string;
    flags: string;
    role_method: string;
    role_version: string;
};

const INSERT_FROM_JSON = `INSERT INTO provisions (
        id, document_id, parent_id, ordinal, level, number, title, text, article_no, paragraph_no, point_no,
        page_start, page_end, source_quote, read_quality, source_snapshot_id, pdf_sha256, read_method, source_regions, content_role, relevance, container_provision_id,
        quoted_segments, flags, role_method, role_version, created_at
    )
    SELECT
        json_extract(value, '$.id'), json_extract(value, '$.document_id'), json_extract(value, '$.parent_id'),
        json_extract(value, '$.ordinal'), json_extract(value, '$.level'), json_extract(value, '$.number'),
        json_extract(value, '$.title'), json_extract(value, '$.text'), json_extract(value, '$.article_no'),
        json_extract(value, '$.paragraph_no'), json_extract(value, '$.point_no'), json_extract(value, '$.page_start'),
        json_extract(value, '$.page_end'), json_extract(value, '$.source_quote'), json_extract(value, '$.read_quality'),
        json_extract(value, '$.source_snapshot_id'), json_extract(value, '$.pdf_sha256'), json_extract(value, '$.read_method'),
        json_extract(value, '$.source_regions'),
        json_extract(value, '$.content_role'), json_extract(value, '$.relevance'),
        json_extract(value, '$.container_provision_id'), json_extract(value, '$.quoted_segments'),
        json_extract(value, '$.flags'), json_extract(value, '$.role_method'), json_extract(value, '$.role_version'), ?
    FROM json_each(?)
    ORDER BY CAST(key AS INTEGER)`;

/** Replaces every provision of the document in one atomic batch, so a re-run never leaves stale or duplicate rows. */
export async function replaceProvisions(
    db: D1Database,
    documentId: string,
    provisions: Provision[],
    source: ProvisionSource,
): Promise<void> {
    const createdAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
        db.prepare("DELETE FROM provisions WHERE document_id = ?").bind(documentId),
    ];

    for (let start = 0; start < provisions.length; start += INSERT_CHUNK_SIZE) {
        const chunk = provisions.slice(start, start + INSERT_CHUNK_SIZE).map((provision) => toRowJson(provision, source));

        statements.push(db.prepare(INSERT_FROM_JSON).bind(createdAt, JSON.stringify(chunk)));
    }

    await db.batch(statements);
}

export async function listProvisions(db: D1Database, documentId: string): Promise<StoredProvision[]> {
    const result = await db
        .prepare("SELECT * FROM provisions WHERE document_id = ? ORDER BY ordinal")
        .bind(documentId)
        .all<ProvisionRow>();

    return result.results.map(toStoredProvision);
}

/**
 * Rule placement (#15) proved that these quoted units are behaviours of a fine clause in the provision they
 * rewrite; their relevance, UNCERTAIN until then, becomes VIOLATION_RULE.
 */
export async function markQuotedBehaviours(db: D1Database, provisionIds: string[]): Promise<void> {
    if (provisionIds.length === 0) {
        return;
    }

    await db
        .prepare(
            `UPDATE provisions SET relevance = 'VIOLATION_RULE'
             WHERE content_role = 'QUOTED_NEW_TEXT' AND relevance IN ('UNCERTAIN', 'IRRELEVANT', 'REFERENCE')
               AND id IN (SELECT value FROM json_each(?))`
        )
        .bind(JSON.stringify(provisionIds))
        .run();
}

export async function deleteProvisions(db: D1Database, documentId: string): Promise<void> {
    await db.prepare("DELETE FROM provisions WHERE document_id = ?").bind(documentId).run();
}

function toRowJson(provision: Provision, source: ProvisionSource): Record<string, unknown> {
    return {
        id: provision.id,
        document_id: provision.documentId,
        parent_id: provision.parentId,
        ordinal: provision.ordinal,
        level: provision.level,
        number: provision.number,
        title: provision.title,
        text: provision.text,
        article_no: provision.articleNo,
        paragraph_no: provision.paragraphNo,
        point_no: provision.pointNo,
        page_start: provision.pageStart,
        page_end: provision.pageEnd,
        source_quote: provision.sourceQuote,
        read_quality: provision.readQuality,
        source_snapshot_id: source.sourceSnapshotId,
        pdf_sha256: source.pdfSha256,
        read_method: source.readMethod,
        source_regions: provision.sourceRegions,
        content_role: provision.contentRole,
        relevance: provision.relevance,
        container_provision_id: provision.containerProvisionId,
        quoted_segments: provision.quotedSegments,
        flags: provision.flags,
        role_method: ROLE_METHOD,
        role_version: ROLE_VERSION,
    };
}

function toStoredProvision(row: ProvisionRow): StoredProvision {
    return {
        id: row.id,
        documentId: row.document_id,
        parentId: row.parent_id,
        ordinal: row.ordinal,
        level: row.level,
        number: row.number,
        title: row.title,
        text: row.text,
        articleNo: row.article_no,
        paragraphNo: row.paragraph_no,
        pointNo: row.point_no,
        pageStart: row.page_start,
        pageEnd: row.page_end,
        sourceQuote: row.source_quote,
        readQuality: row.read_quality,
        sourceSnapshotId: row.source_snapshot_id,
        pdfSha256: row.pdf_sha256,
        readMethod: row.read_method,
        sourceRegions: JSON.parse(row.source_regions),
        contentRole: row.content_role,
        relevance: row.relevance,
        containerProvisionId: row.container_provision_id,
        quotedSegments: JSON.parse(row.quoted_segments),
        flags: JSON.parse(row.flags),
        roleMethod: row.role_method,
        roleVersion: row.role_version,
    };
}
