import type { D1Database } from "@cloudflare/workers-types";
import { getAuthSession } from "../../plugins/auth";
import type { Env } from "../../types/env";
import type { CreateWorkspaceInput, UpdateWorkspaceInput, WorkspaceAccessResult, WorkspaceSummary } from "./workspace.types";

export const DEFAULT_WORKSPACE_ID = "default";

type WorkspaceRow = {
    id: string;
    owner_user_id: string;
    name: string;
    description: string | null;
    domain: string;
    created_at: string;
    updated_at: string;
};

type CountRow = {
    count: number;
};

function generateWorkspaceId(): string {
    return `ws-${crypto.randomUUID().slice(0, 12)}`;
}

async function getWorkspaceStats(db: D1Database, workspaceId: string): Promise<WorkspaceSummary["stats"]> {
    const [docs, provs, docRels, manualSanctions, aiSanctions] = await Promise.all([
        db
            .prepare("SELECT COUNT(*) AS count FROM legal_documents WHERE workspace_id = ? AND review_status = 'ACCEPTED'")
            .bind(workspaceId)
            .first<CountRow>(),
        db
            .prepare(
                `SELECT COUNT(*) AS count FROM provisions p
                 INNER JOIN legal_documents d ON d.id = p.document_id
                 WHERE d.workspace_id = ? AND d.review_status = 'ACCEPTED'`,
            )
            .bind(workspaceId)
            .first<CountRow>(),
        db
            .prepare("SELECT COUNT(*) AS count FROM document_relations WHERE workspace_id = ? AND verification_status = 'ACCEPTED'")
            .bind(workspaceId)
            .first<CountRow>(),
        db
            .prepare("SELECT COUNT(*) AS count FROM sanction_change_edges WHERE workspace_id = ?")
            .bind(workspaceId)
            .first<CountRow>(),
        db
            .prepare(
                `SELECT COUNT(*) AS count FROM change_events ce
                 INNER JOIN traffic_violations tv ON tv.id = ce.traffic_violation_id
                 WHERE tv.workspace_id = ?`,
            )
            .bind(workspaceId)
            .first<CountRow>(),
    ]);

    return {
        documentCount: Number(docs?.count ?? 0),
        provisionCount: Number(provs?.count ?? 0),
        relationCount: Number(docRels?.count ?? 0),
        sanctionChangeCount: Number(manualSanctions?.count ?? 0) + Number(aiSanctions?.count ?? 0),
    };
}

async function toSummary(db: D1Database, row: WorkspaceRow): Promise<WorkspaceSummary> {
    const stats = await getWorkspaceStats(db, row.id);

    return {
        id: row.id,
        ownerUserId: row.owner_user_id,
        name: row.name,
        description: row.description,
        domain: row.domain,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        stats,
    };
}

/** Lists workspaces owned by the user; auto-provisions an initial workspace if the user has none. */
export async function listWorkspacesForUser(db: D1Database, userId: string): Promise<WorkspaceSummary[]> {
    const existing = await db
        .prepare("SELECT * FROM workspaces WHERE owner_user_id = ? ORDER BY created_at ASC")
        .bind(userId)
        .all<WorkspaceRow>();

    if (existing.results.length === 0) {
        const initial = await createWorkspace(db, userId, {
            name: "Dự thảo Luật Giao thông 2026",
            description: "Không gian soạn thảo mặc định — soạn dự thảo, quản lý khung xử phạt và lược đồ tác động.",
            domain: "traffic",
            seedSample: true,
        });

        return [initial];
    }

    return Promise.all(existing.results.map((row) => toSummary(db, row)));
}

export async function createWorkspace(db: D1Database, userId: string, input: CreateWorkspaceInput): Promise<WorkspaceSummary> {
    const id = generateWorkspaceId();
    const now = new Date().toISOString();
    const name = input.name.trim();
    const description = input.description?.trim() || null;
    const domain = input.domain?.trim() || "general";

    await db
        .prepare(
            `INSERT INTO workspaces (id, owner_user_id, name, description, domain, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, userId, name, description, domain, now, now)
        .run();

    if (input.seedSample) {
        await seedSampleLegislativeDataset(db, id);
    }

    const row: WorkspaceRow = {
        id,
        owner_user_id: userId,
        name,
        description,
        domain,
        created_at: now,
        updated_at: now,
    };

    return toSummary(db, row);
}

export async function updateWorkspace(
    db: D1Database,
    userId: string,
    workspaceId: string,
    input: UpdateWorkspaceInput,
): Promise<WorkspaceSummary | null> {
    const existing = await db
        .prepare("SELECT * FROM workspaces WHERE id = ? AND owner_user_id = ?")
        .bind(workspaceId, userId)
        .first<WorkspaceRow>();

    if (!existing) {
        return null;
    }

    const nextName = input.name?.trim() || existing.name;
    const nextDescription = input.description !== undefined ? input.description?.trim() || null : existing.description;
    const nextDomain = input.domain?.trim() || existing.domain;
    const now = new Date().toISOString();

    await db
        .prepare("UPDATE workspaces SET name = ?, description = ?, domain = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?")
        .bind(nextName, nextDescription, nextDomain, now, workspaceId, userId)
        .run();

    return toSummary(db, {
        ...existing,
        name: nextName,
        description: nextDescription,
        domain: nextDomain,
        updated_at: now,
    });
}

export async function deleteWorkspace(db: D1Database, userId: string, workspaceId: string): Promise<boolean> {
    const existing = await db
        .prepare("SELECT id FROM workspaces WHERE id = ? AND owner_user_id = ?")
        .bind(workspaceId, userId)
        .first<{ id: string }>();

    if (!existing) {
        return false;
    }

    await db.prepare("DELETE FROM sanction_change_edges WHERE workspace_id = ?").bind(workspaceId).run();
    await db.prepare("DELETE FROM provision_relations WHERE workspace_id = ?").bind(workspaceId).run();
    await db.prepare("DELETE FROM document_relations WHERE workspace_id = ?").bind(workspaceId).run();
    await db.prepare("DELETE FROM traffic_violations WHERE workspace_id = ?").bind(workspaceId).run();
    await db.prepare("DELETE FROM legal_documents WHERE workspace_id = ?").bind(workspaceId).run();
    await db.prepare("DELETE FROM processing_jobs WHERE workspace_id = ?").bind(workspaceId).run();
    await db.prepare("DELETE FROM workspaces WHERE id = ? AND owner_user_id = ?").bind(workspaceId, userId).run();

    return true;
}

/**
 * Resolves and authorizes the active workspace for a request.
 * When X-Workspace-Id is supplied, verifies the authenticated user owns that workspace.
 */
export async function resolveWorkspaceAccess(
    env: Env,
    request: Request,
    options: { requireAuth?: boolean } = {},
): Promise<WorkspaceAccessResult> {
    const url = new URL(request.url);
    const requestedWorkspaceId = request.headers.get("x-workspace-id")?.trim() || url.searchParams.get("workspace_id")?.trim() || null;
    const session = await getAuthSession(env, request);

    if (options.requireAuth && !session) {
        return { ok: false, status: 401, message: "Vui lòng đăng nhập để thực hiện thao tác này" };
    }

    if (requestedWorkspaceId) {
        if (!session) {
            return { ok: false, status: 401, message: "Vui lòng đăng nhập để truy cập không gian làm việc" };
        }

        const owned = await env.DB.prepare("SELECT id FROM workspaces WHERE id = ? AND owner_user_id = ?")
            .bind(requestedWorkspaceId, session.user.id)
            .first<{ id: string }>();

        if (!owned) {
            return { ok: false, status: 403, message: "Bạn không có quyền truy cập không gian làm việc này" };
        }

        return { ok: true, workspaceId: owned.id, userId: session.user.id };
    }

    if (session) {
        const userWorkspaces = await listWorkspacesForUser(env.DB, session.user.id);

        return { ok: true, workspaceId: userWorkspaces[0].id, userId: session.user.id };
    }

    return { ok: true, workspaceId: DEFAULT_WORKSPACE_ID, userId: null };
}

/** Seeds a realistic legislative drafting dataset (ND 100/2019 -> ND 123/2021 -> ND 168/2024 -> Du thao 2026) inside a workspace. */
export async function seedSampleLegislativeDataset(db: D1Database, workspaceId: string): Promise<void> {
    const now = new Date().toISOString();
    const doc100 = `${workspaceId}-doc-nd100`;
    const doc123 = `${workspaceId}-doc-nd123`;
    const doc168 = `${workspaceId}-doc-nd168`;
    const docTt73 = `${workspaceId}-doc-tt73`;
    const docDraft = `${workspaceId}-doc-draft2026`;

    const documents = [
        {
            id: doc100,
            title: "Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực giao thông đường bộ và đường sắt",
            number: "100/2019/NĐ-CP",
            normalized: "100/2019/ND-CP",
            type: "Nghị định",
            agency: "Chính phủ",
            issuedAt: "2019-12-30",
            effectiveFrom: "2020-01-01",
            model: "AI_EXTRACTED",
        },
        {
            id: doc123,
            title: "Nghị định sửa đổi, bổ sung một số điều của các Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực giao thông",
            number: "123/2021/NĐ-CP",
            normalized: "123/2021/ND-CP",
            type: "Nghị định",
            agency: "Chính phủ",
            issuedAt: "2021-12-28",
            effectiveFrom: "2022-01-01",
            model: "AI_EXTRACTED",
        },
        {
            id: doc168,
            title: "Nghị định quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông trong lĩnh vực giao thông đường bộ; trừ điểm, phục hồi điểm giấy phép lái xe",
            number: "168/2024/NĐ-CP",
            normalized: "168/2024/ND-CP",
            type: "Nghị định",
            agency: "Chính phủ",
            issuedAt: "2024-12-26",
            effectiveFrom: "2025-01-01",
            model: "AI_EXTRACTED",
        },
        {
            id: docTt73,
            title: "Thông tư quy định công tác tuần tra, kiểm soát, xử lý vi phạm pháp luật về trật tự, an toàn giao thông đường bộ",
            number: "73/2024/TT-BCA",
            normalized: "73/2024/TT-BCA",
            type: "Thông tư",
            agency: "Bộ Công an",
            issuedAt: "2024-11-15",
            effectiveFrom: "2025-01-01",
            model: "AI_EXTRACTED",
        },
        {
            id: docDraft,
            title: "Dự thảo Nghị định sửa đổi mức xử phạt và cơ chế trừ điểm GPLX đối với hành vi vi phạm trên cao tốc",
            number: "Dự thảo 01/2026/NĐ-CP",
            normalized: "DU THAO 01/2026/ND-CP",
            type: "Dự thảo",
            agency: "Bộ Công an (Cơ quan chủ trì soạn thảo)",
            issuedAt: "2026-06-01",
            effectiveFrom: "2026-10-01",
            model: "MANUAL",
        },
    ];

    for (const doc of documents) {
        const seedJobId = `seed-job-${doc.id}`;

        await db
            .prepare(
                `INSERT INTO processing_jobs (
                    id, workspace_id, file_key, original_filename, mime_type, file_size,
                    status, step, progress, created_at, updated_at, completed_at
                ) VALUES (?, ?, ?, ?, 'application/json', 0, 'completed', 'done', 100, ?, ?, ?)`,
            )
            .bind(seedJobId, workspaceId, `seed/${doc.id}.json`, `${doc.number}.json`, now, now, now)
            .run();

        await db
            .prepare(
                `INSERT INTO legal_documents (
                    id, workspace_id, job_id, document_title, json_content, snapshot_r2_key, artifact_r2_key,
                    pdf_sha256, review_status, validation_issues, page_count, extraction_model, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACCEPTED', '[]', 1, ?, ?)`,
            )
            .bind(
                doc.id,
                workspaceId,
                seedJobId,
                doc.title,
                JSON.stringify({ document_title: doc.title, articles: [] }),
                `seed/${doc.id}.pdf`,
                `seed/${doc.id}.json`,
                `sha-${doc.id}`,
                doc.model,
                now,
            )
            .run();

        await db
            .prepare(
                `INSERT INTO document_metadata (
                    document_id, document_number, normalized_number, document_type, agency, issued_at, effective_from, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(doc.id, doc.number, doc.normalized, doc.type, doc.agency, doc.issuedAt, doc.effectiveFrom, now)
            .run();
    }

    // Seed structured provisions (Điều -> Khoản -> Điểm)
    const sampleProvisions = [
        // ND 100
        { id: `${doc100}:d5`, docId: doc100, parentId: null, ord: 1, level: "ARTICLE", num: "5", title: "Xử phạt người điều khiển xe ô tô vi phạm quy tắc giao thông", text: null, a: "5", p: null, pt: null },
        { id: `${doc100}:d5k5`, docId: doc100, parentId: `${doc100}:d5`, ord: 2, level: "CLAUSE", num: "5", title: null, text: "Phạt tiền từ 3.000.000 đồng đến 5.000.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:", a: "5", p: "5", pt: null },
        { id: `${doc100}:d5k5da`, docId: doc100, parentId: `${doc100}:d5k5`, ord: 3, level: "POINT", num: "a", title: null, text: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông.", a: "5", p: "5", pt: "a" },
        { id: `${doc100}:d5k7`, docId: doc100, parentId: `${doc100}:d5`, ord: 4, level: "CLAUSE", num: "7", title: null, text: "Phạt tiền từ 10.000.000 đồng đến 12.000.000 đồng đối với hành vi dừng xe, đỗ xe trên đường cao tốc không đúng nơi quy định.", a: "5", p: "7", pt: null },
        // ND 123
        { id: `${doc123}:d2`, docId: doc123, parentId: null, ord: 1, level: "ARTICLE", num: "2", title: "Sửa đổi, bổ sung một số điều của Nghị định 100/2019/NĐ-CP", text: null, a: "2", p: null, pt: null },
        { id: `${doc123}:d2k3`, docId: doc123, parentId: `${doc123}:d2`, ord: 2, level: "CLAUSE", num: "3", title: null, text: "Sửa đổi điểm a khoản 5 Điều 5 Nghị định 100/2019/NĐ-CP: nâng mức phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với hành vi không chấp hành hiệu lệnh của đèn tín hiệu giao thông.", a: "2", p: "3", pt: null },
        // ND 168
        { id: `${doc168}:d6`, docId: doc168, parentId: null, ord: 1, level: "ARTICLE", num: "6", title: "Xử phạt, trừ điểm giấy phép lái xe của người điều khiển xe ô tô", text: null, a: "6", p: null, pt: null },
        { id: `${doc168}:d6k9`, docId: doc168, parentId: `${doc168}:d6`, ord: 2, level: "CLAUSE", num: "9", title: null, text: "Phạt tiền từ 18.000.000 đồng đến 20.000.000 đồng và trừ 04 điểm giấy phép lái xe đối với người điều khiển xe thực hiện hành vi:", a: "6", p: "9", pt: null },
        { id: `${doc168}:d6k9db`, docId: doc168, parentId: `${doc168}:d6k9`, ord: 3, level: "POINT", num: "b", title: null, text: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông.", a: "6", p: "9", pt: "b" },
        { id: `${doc168}:d6k7`, docId: doc168, parentId: `${doc168}:d6`, ord: 4, level: "CLAUSE", num: "7", title: null, text: "Phạt tiền từ 12.000.000 đồng đến 14.000.000 đồng và trừ 06 điểm giấy phép lái xe đối với hành vi dừng xe, đỗ xe trên đường cao tốc không đúng nơi quy định.", a: "6", p: "7", pt: null },
        // Draft 2026
        { id: `${docDraft}:d1`, docId: docDraft, parentId: null, ord: 1, level: "ARTICLE", num: "1", title: "Điều chỉnh khung xử phạt và trừ điểm trên đường cao tốc", text: null, a: "1", p: null, pt: null },
        { id: `${docDraft}:d1k1`, docId: docDraft, parentId: `${docDraft}:d1`, ord: 2, level: "CLAUSE", num: "1", title: null, text: "Phạt tiền từ 14.000.000 đồng đến 18.000.000 đồng và trừ 08 điểm giấy phép lái xe đối với hành vi dừng xe, đỗ xe trái phép trên đường cao tốc không có báo hiệu.", a: "1", p: "1", pt: null },
        { id: `${docDraft}:d1k2`, docId: docDraft, parentId: `${docDraft}:d1`, ord: 3, level: "CLAUSE", num: "2", title: null, text: "Giảm nhẹ mức phạt còn 12.000.000 đồng đến 15.000.000 đồng đối với vi phạm đèn tín hiệu lần đầu không gây hậu quả và đã khắc phục ngay.", a: "1", p: "2", pt: null },
    ];

    for (const prov of sampleProvisions) {
        await db
            .prepare(
                `INSERT INTO provisions (
                    id, document_id, parent_id, ordinal, level, number, title, text,
                    article_no, paragraph_no, point_no, content_role, relevance, role_method, role_version, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NORM', 'CORE', 'MANUAL', '1.0', ?)`,
            )
            .bind(prov.id, prov.docId, prov.parentId, prov.ord, prov.level, prov.num, prov.title, prov.text, prov.a, prov.p, prov.pt, now)
            .run();
    }

    // Seed Document Relations (Mode 2: Legal Influence)
    const docRelations = [
        { id: `${workspaceId}-dr-1`, from: doc123, to: doc100, type: "AMENDS", scope: "PARTIAL", mode: "AI", note: "Sửa đổi, bổ sung một số điều của Nghị định 100/2019/NĐ-CP" },
        { id: `${workspaceId}-dr-2`, from: doc168, to: doc100, type: "REPLACES", scope: "FULL", mode: "AI", note: "Thay thế các quy định xử phạt giao thông đường bộ tại Nghị định 100/2019/NĐ-CP" },
        { id: `${workspaceId}-dr-3`, from: doc168, to: doc123, type: "REPEALS", scope: "PARTIAL", mode: "AI", note: "Bãi bỏ các điều khoản sửa đổi giao thông đường bộ của Nghị định 123/2021/NĐ-CP" },
        { id: `${workspaceId}-dr-4`, from: docTt73, to: doc168, type: "GUIDES", scope: "PARTIAL", mode: "AI", note: "Hướng dẫn quy trình tuần tra, xử lý vi phạm và trừ điểm GPLX theo Nghị định 168/2024/NĐ-CP" },
        { id: `${workspaceId}-dr-5`, from: docDraft, to: doc168, type: "AMENDS", scope: "PARTIAL", mode: "MANUAL", note: "Dự thảo sửa đổi Điều 6 Nghị định 168/2024/NĐ-CP về vi phạm cao tốc" },
    ];

    for (const rel of docRelations) {
        await db
            .prepare(
                `INSERT INTO document_relations (
                    id, workspace_id, from_document_id, to_document_id, relation_type, scope,
                    verification_status, evidence_level, method, source_mode, note, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'ACCEPTED', 'EXPLICIT', ?, ?, ?, ?)`,
            )
            .bind(rel.id, workspaceId, rel.from, rel.to, rel.type, rel.scope, rel.mode, rel.mode, rel.note, now)
            .run();
    }

    // Seed Provision Relations
    await db
        .prepare(
            `INSERT INTO change_instructions (
                id, source_document_id, source_provision_id, operation, raw_text, raw_target_citation,
                target_document_id, target_scope, resolution_status, resolution_reason, method, extractor_version, created_at
            ) VALUES (?, ?, ?, 'AMEND', 'Sửa đổi điểm a khoản 5 Điều 5 Nghị định 100/2019/NĐ-CP', 'điểm a khoản 5 Điều 5', ?, 'PROVISION', 'RESOLVED', 'seed', 'MANUAL', '1.0', ?)`,
        )
        .bind(`${workspaceId}-ci-1`, doc123, `${doc123}:d2k3`, doc100, now)
        .run();

    await db
        .prepare(
            `INSERT INTO provision_relations (
                id, workspace_id, change_instruction_id, from_document_id, from_provision_id,
                to_document_id, to_provision_id, relation_type, target_locator, verification_status,
                evidence_level, evidence_text, effective_from, method, extractor_version, source_mode, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'AMENDS', 'điểm a khoản 5 Điều 5', 'ACCEPTED', 'EXPLICIT', 'Nâng mức phạt không chấp hành đèn tín hiệu từ 3-5 triệu lên 4-6 triệu.', '2022-01-01', 'AI', '1.0', 'AI', ?)`,
        )
        .bind(`${workspaceId}-pr-1`, workspaceId, `${workspaceId}-ci-1`, doc123, `${doc123}:d2k3`, doc100, `${doc100}:d5k5da`, now)
        .run();

    await db
        .prepare(
            `INSERT INTO change_instructions (
                id, source_document_id, source_provision_id, operation, raw_text, raw_target_citation,
                target_document_id, target_scope, resolution_status, resolution_reason, method, extractor_version, created_at
            ) VALUES (?, ?, ?, 'AMEND', 'Sửa đổi khoản 7 Điều 6 Nghị định 168/2024/NĐ-CP', 'khoản 7 Điều 6', ?, 'PROVISION', 'RESOLVED', 'seed', 'MANUAL', '1.0', ?)`,
        )
        .bind(`${workspaceId}-ci-2`, docDraft, `${docDraft}:d1k1`, doc168, now)
        .run();

    await db
        .prepare(
            `INSERT INTO provision_relations (
                id, workspace_id, change_instruction_id, from_document_id, from_provision_id,
                to_document_id, to_provision_id, relation_type, target_locator, verification_status,
                evidence_level, evidence_text, effective_from, method, extractor_version, source_mode, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'AMENDS', 'khoản 7 Điều 6', 'ACCEPTED', 'MANUAL', 'Điều chỉnh khung phạt dừng, đỗ xe trái phép trên đường cao tốc lên 14–18 triệu và trừ 08 điểm GPLX.', '2026-10-01', 'MANUAL', '1.0', 'MANUAL', ?)`,
        )
        .bind(`${workspaceId}-pr-2`, workspaceId, `${workspaceId}-ci-2`, docDraft, `${docDraft}:d1k1`, doc168, `${doc168}:d6k7`, now)
        .run();

    // Seed Sanction Change Edges (Mode 1: Penalty / Sanction Escalation & Shifts)
    const sanctionEdges = [
        {
            id: `${workspaceId}-sc-1`,
            fromDoc: doc123,
            toDoc: doc100,
            fromProv: `${doc123}:d2k3`,
            toProv: `${doc100}:d5k5da`,
            behavior: "Ô tô không chấp hành hiệu lệnh đèn tín hiệu giao thông",
            changeType: "SANCTION_INCREASE",
            oldText: "3.000.000 – 5.000.000 đ",
            newText: "4.000.000 – 6.000.000 đ",
            oldMin: 3000000,
            oldMax: 5000000,
            newMin: 4000000,
            newMax: 6000000,
            note: "AI phát hiện tăng nặng khung phạt tiền +20% (Nghị định 123/2021 sửa Nghị định 100/2019).",
            sourceMode: "AI",
        },
        {
            id: `${workspaceId}-sc-2`,
            fromDoc: doc168,
            toDoc: doc123,
            fromProv: `${doc168}:d6k9db`,
            toProv: `${doc123}:d2k3`,
            behavior: "Ô tô không chấp hành hiệu lệnh đèn tín hiệu giao thông",
            changeType: "SANCTION_INCREASE",
            oldText: "4.000.000 – 6.000.000 đ",
            newText: "18.000.000 – 20.000.000 đ + trừ 04 điểm GPLX",
            oldMin: 4000000,
            oldMax: 6000000,
            newMin: 18000000,
            newMax: 20000000,
            note: "AI phát hiện tăng nặng mạnh mức phạt (+233%) và bổ sung cơ chế trừ điểm GPLX.",
            sourceMode: "AI",
        },
        {
            id: `${workspaceId}-sc-3`,
            fromDoc: doc168,
            toDoc: doc100,
            fromProv: `${doc168}:d6k7`,
            toProv: `${doc100}:d5k7`,
            behavior: "Dừng xe, đỗ xe trên đường cao tốc không đúng nơi quy định",
            changeType: "POINT_DEDUCTION_CHANGED",
            oldText: "10.000.000 – 12.000.000 đ",
            newText: "12.000.000 – 14.000.000 đ + trừ 06 điểm GPLX",
            oldMin: 10000000,
            oldMax: 12000000,
            newMin: 12000000,
            newMax: 14000000,
            note: "AI phát hiện tăng phạt tiền và áp dụng trừ 06 điểm GPLX.",
            sourceMode: "AI",
        },
        {
            id: `${workspaceId}-sc-4`,
            fromDoc: docDraft,
            toDoc: doc168,
            fromProv: `${docDraft}:d1k1`,
            toProv: `${doc168}:d6k7`,
            behavior: "Dừng xe, đỗ xe trái phép trên đường cao tốc không báo hiệu",
            changeType: "SANCTION_INCREASE",
            oldText: "12.000.000 – 14.000.000 đ (trừ 6 điểm)",
            newText: "14.000.000 – 18.000.000 đ (trừ 8 điểm)",
            oldMin: 12000000,
            oldMax: 14000000,
            newMin: 14000000,
            newMax: 18000000,
            note: "Đề xuất dự thảo 2026 tăng khung phạt và nâng mức trừ điểm GPLX lên 08 điểm.",
            sourceMode: "MANUAL",
        },
        {
            id: `${workspaceId}-sc-5`,
            fromDoc: docDraft,
            toDoc: doc168,
            fromProv: `${docDraft}:d1k2`,
            toProv: `${doc168}:d6k9db`,
            behavior: "Vi phạm đèn tín hiệu lần đầu, không gây hậu quả",
            changeType: "SANCTION_DECREASE",
            oldText: "18.000.000 – 20.000.000 đ",
            newText: "12.000.000 – 15.000.000 đ",
            oldMin: 18000000,
            oldMax: 20000000,
            newMin: 12000000,
            newMax: 15000000,
            note: "Đề xuất phân hóa giảm nhẹ mức phạt đối với vi phạm lần đầu không gây hậu quả.",
            sourceMode: "MANUAL",
        },
    ];

    for (const edge of sanctionEdges) {
        await db
            .prepare(
                `INSERT INTO sanction_change_edges (
                    id, workspace_id, from_document_id, to_document_id, from_provision_id, to_provision_id,
                    behavior_summary, change_type, old_penalty_text, new_penalty_text,
                    old_fine_min, old_fine_max, new_fine_min, new_fine_max, note, source_mode, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
                edge.id,
                workspaceId,
                edge.fromDoc,
                edge.toDoc,
                edge.fromProv,
                edge.toProv,
                edge.behavior,
                edge.changeType,
                edge.oldText,
                edge.newText,
                edge.oldMin,
                edge.oldMax,
                edge.newMin,
                edge.newMax,
                edge.note,
                edge.sourceMode,
                now,
            )
            .run();
    }
}
