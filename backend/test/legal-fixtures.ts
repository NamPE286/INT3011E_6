import type { D1Database } from "@cloudflare/workers-types";
import { analyzeStoredDocument } from "../src/modules/provisions/provision.service";

export type FixtureQuoted = {
    kind: "article" | "clause" | "point" | "text";
    number: string;
    title?: string | null;
    content?: string | null;
    children?: FixtureQuoted[];
};

export type FixtureNode = {
    number: string;
    title?: string | null;
    content?: string | null;
    clauses?: FixtureNode[];
    points?: FixtureNode[];
    /** Quoted new wording as the quote-aware assembler stores it. */
    quoted?: FixtureQuoted[];
};

export type FixtureDocument = {
    id: string;
    title: string;
    /** Root content: national motto, "Số: …", place/date and "Căn cứ …" lines. */
    content: string;
    articles: FixtureNode[];
    reviewStatus?: "ACCEPTED" | "REVIEW_REQUIRED";
};

/** Stores a legal-json-v1 document the way the pipeline does and analyzes its provisions. */
export async function storeLegalDocument(db: D1Database, fixture: FixtureDocument): Promise<void> {
    const legalJson = {
        document_title: fixture.title,
        content: fixture.content,
        source: { snapshot_id: fixture.id, pdf_sha256: `sha-${fixture.id}`, part_index: 0 },
        parts: [],
        chapters: [],
        sections: [],
        articles: fixture.articles.map(toLegalNode),
    };

    await db
        .prepare(
            `INSERT INTO legal_documents (
                id, job_id, document_title, json_content, snapshot_r2_key, artifact_r2_key, pdf_sha256, review_status,
                extraction_model, prompt_version, schema_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test-model', 'test-prompt', 'legal-json-v1', datetime('now'))`
        )
        .bind(
            fixture.id,
            fixture.id,
            fixture.title,
            JSON.stringify(legalJson),
            `uploads/${fixture.id}.pdf`,
            `runs/${fixture.id}/validated.json`,
            `sha-${fixture.id}`,
            fixture.reviewStatus ?? "ACCEPTED",
        )
        .run();

    await analyzeStoredDocument(db, fixture.id);
}

const LOCATOR = {
    page_start: 1,
    page_end: 1,
    regions: [],
    source_quote: null,
    method: "LLM",
    quality: "GOOD",
};

function toLegalNode(node: FixtureNode): Record<string, unknown> {
    const legalNode: Record<string, unknown> = {
        number: node.number,
        title: node.title ?? null,
        content: node.content ?? null,
        source_locator: LOCATOR,
        clauses: (node.clauses ?? []).map(toLegalNode),
        points: (node.points ?? []).map(toLegalNode),
    };

    if (node.quoted) {
        legalNode.quoted = node.quoted.map(toQuotedNode);
    }

    return legalNode;
}

function toQuotedNode(node: FixtureQuoted): Record<string, unknown> {
    return {
        kind: node.kind,
        number: node.number,
        title: node.title ?? null,
        content: node.content ?? null,
        source_locator: LOCATOR,
        children: (node.children ?? []).map(toQuotedNode),
    };
}

/** Nghị định 100/2019/NĐ-CP, reduced to the provisions the tests need. */
export const BASE_DECREE: FixtureDocument = {
    id: "nd-100-2019",
    title: "NGHỊ ĐỊNH Quy định xử phạt vi phạm hành chính trong lĩnh vực giao thông đường bộ và đường sắt",
    content: [
        "CHÍNH PHỦ",
        "Số: 100/2019/NĐ-CP",
        "Hà Nội, ngày 30 tháng 12 năm 2019",
        "Căn cứ Luật Xử lý vi phạm hành chính ngày 20 tháng 6 năm 2012;",
    ].join("\n"),
    articles: [
        {
            number: "5",
            title: "Xử phạt người điều khiển xe ô tô vi phạm quy tắc giao thông đường bộ",
            clauses: [
                {
                    number: "5",
                    content: "Phạt tiền từ 3.000.000 đồng đến 5.000.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:",
                    points: [
                        { number: "a", content: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;" },
                        { number: "b", content: "Không chấp hành hiệu lệnh, hướng dẫn của người điều khiển giao thông hoặc người kiểm soát giao thông;" },
                    ],
                },
                {
                    number: "11",
                    content: "Ngoài việc bị phạt tiền, người điều khiển xe thực hiện hành vi vi phạm còn bị áp dụng các hình thức xử phạt bổ sung sau đây:",
                    points: [
                        { number: "a", content: "Thực hiện hành vi quy định tại điểm a, điểm b khoản 5 Điều này bị tước quyền sử dụng Giấy phép lái xe từ 01 tháng đến 03 tháng;" },
                    ],
                },
            ],
        },
        {
            number: "86",
            title: "Hiệu lực thi hành",
            clauses: [
                { number: "1", content: "Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2020." },
                { number: "2", content: "Nghị định số 46/2016/NĐ-CP ngày 26 tháng 5 năm 2016 của Chính phủ hết hiệu lực kể từ ngày Nghị định này có hiệu lực thi hành." },
            ],
        },
    ],
};

/** Nghị định 123/2021/NĐ-CP amending Nghị định 100/2019/NĐ-CP. */
export const AMENDING_DECREE: FixtureDocument = {
    id: "nd-123-2021",
    title: "NGHỊ ĐỊNH Sửa đổi, bổ sung một số điều của các Nghị định quy định xử phạt vi phạm hành chính trong lĩnh vực hàng hải; giao thông đường bộ, đường sắt",
    content: [
        "CHÍNH PHỦ",
        "Số: 123/2021/NĐ-CP",
        "Hà Nội, ngày 28 tháng 12 năm 2021",
        "Căn cứ Luật Xử lý vi phạm hành chính ngày 20 tháng 6 năm 2012;",
    ].join("\n"),
    articles: [
        {
            number: "2",
            title: "Sửa đổi, bổ sung một số điều của Nghị định số 100/2019/NĐ-CP ngày 30 tháng 12 năm 2019 của Chính phủ quy định xử phạt vi phạm hành chính trong lĩnh vực giao thông đường bộ và đường sắt",
            clauses: [
                {
                    number: "10",
                    content: "Sửa đổi, bổ sung điểm a khoản 5 Điều 5 như sau:",
                    points: [
                        { number: "a", content: "“a) Không chấp hành hiệu lệnh của đèn tín hiệu giao thông theo quy định tại Nghị định số 46/2016/NĐ-CP;”" },
                    ],
                },
                {
                    number: "11",
                    content: "Bãi bỏ điểm b khoản 5 Điều 5.",
                },
            ],
        },
        {
            number: "5",
            title: "Hiệu lực thi hành",
            clauses: [
                { number: "1", content: "Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2022." },
            ],
        },
    ],
};
