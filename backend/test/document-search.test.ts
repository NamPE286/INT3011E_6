import { beforeEach, describe, expect, it } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { DocumentRepository } from "../src/modules/documents/document.repository";
import { DocumentService } from "../src/modules/documents/document.service";
import { createTestD1Database } from "./d1-test-db";

describe("DocumentRepository and DocumentService (search_legal_documents)", () => {
    let db: D1Database;
    let repository: DocumentRepository;
    let service: DocumentService;

    beforeEach(async () => {
        db = createTestD1Database();
        repository = new DocumentRepository(db);
        service = new DocumentService(repository);
    });

    describe("Core Search & Match Criteria", () => {
        it("finds document candidate by exact and normalized document number", async () => {
            // Seed doc in d1-test-db is "Nghị định 100/2019/NĐ-CP"
            // Query with exact number
            const exactRes = await service.searchLegalDocuments({
                query: "100/2019/NĐ-CP",
            });

            expect(exactRes.status).toBe("OK");
            expect(exactRes.candidates.length).toBeGreaterThan(0);
            const first = exactRes.candidates[0];
            expect(first.document_number).toBe("100/2019/NĐ-CP");
            expect(first.title).toBe("Nghị định 100/2019/NĐ-CP");
            expect(first.identity_type).toBe("CORPUS_DOCUMENT");
            expect(first.canonical_document_id).toBeNull(); // Strictly null: never assumed as canonical
            expect(first.match_score).toBeGreaterThanOrEqual(0.4);

            // Query with normalized number (different case, unaccented)
            const normRes = await service.searchLegalDocuments({
                query: "nghi dinh 100/2019/nd-cp",
                document_number: "100/2019/nd-cp",
            });

            expect(normRes.status).toBe("OK");
            expect(normRes.candidates.length).toBeGreaterThan(0);
            expect(normRes.candidates[0].document_number).toBe("100/2019/NĐ-CP");
        });

        it("filters candidates by title, agency, document type, and date bounds", async () => {
            // Seed a second legal doc: "Luật Giao thông đường bộ số 23/2008/QH12"
            const docLuat = {
                document_title: "Luật số 23/2008/QH12 ngày 13 tháng 11 năm 2008 về Giao thông đường bộ",
                articles: [
                    {
                        number: "1",
                        title: "Phạm vi điều chỉnh",
                        content: "Luật này quy định về quy tắc giao thông đường bộ",
                        clauses: [],
                    },
                ],
            };

            await db.prepare(`
                INSERT INTO legal_documents (
                    id, job_id, document_title, json_content, snapshot_r2_key, artifact_r2_key, pdf_sha256, created_at
                ) VALUES (
                    'doc-seed-luat2008',
                    'job-seed-luat2008',
                    'Luật số 23/2008/QH12 ngày 13 tháng 11 năm 2008 về Giao thông đường bộ',
                    ?,
                    'snapshots/luat2008.pdf',
                    'snapshots/luat2008.extracted.json',
                    'sha256-luat2008',
                    datetime('now')
                )
            `).bind(JSON.stringify(docLuat)).run();

            // Search with agency = "Chính phủ" and document_type = "Nghị định"
            const cpRes = await service.searchLegalDocuments({
                query: "giao thông",
                agency: "Chính phủ",
                document_type: "Nghị định",
            });

            expect(cpRes.candidates.length).toBe(1);
            expect(cpRes.candidates[0].candidate_id).toBe("doc-seed-nd100");
            expect(cpRes.candidates[0].agency).toBe("Chính phủ");

            // Search with agency = "Quốc hội" and date filter
            const qhRes = await service.searchLegalDocuments({
                query: "Giao thông đường bộ",
                agency: "Quốc hội",
                document_type: "Luật",
                issued_from: "2008-01-01",
                issued_to: "2008-12-31",
            });

            expect(qhRes.candidates.length).toBe(1);
            expect(qhRes.candidates[0].candidate_id).toBe("doc-seed-luat2008");
            expect(qhRes.candidates[0].agency).toBe("Quốc hội");
            expect(qhRes.candidates[0].issued_at).toBe("2008-11-13");
        });

        it("performs content keyword search into json_content when not mentioned in title", async () => {
            // In doc-seed-nd100 json_content: "Đường cao tốc là đường dành cho xe cơ giới chạy tốc độ cao"
            const res = await service.searchLegalDocuments({
                query: "chạy tốc độ cao trên đường cao tốc",
            });

            expect(res.candidates.length).toBeGreaterThan(0);
            const matched = res.candidates.find((c) => c.candidate_id === "doc-seed-nd100");
            expect(matched).toBeDefined();
            expect(matched?.match_reasons.some((r) => r.includes("nội dung"))).toBe(true);
        });
    });

    describe("Ambiguity, Multiple Candidates, and Identity Invariants", () => {
        it("returns AMBIGUOUS status and preserves multiple candidates when query matches multiple documents", async () => {
            // Seed two documents with related subject matter
            const docA = {
                document_title: "Nghị định 123/2021/NĐ-CP sửa đổi bổ sung Nghị định 100/2019/NĐ-CP",
                articles: [
                    {
                        number: "1",
                        title: "Sửa đổi",
                        content: "Sửa đổi xử phạt vi phạm giao thông đường bộ",
                        clauses: [],
                    },
                ],
            };

            await db.prepare(`
                INSERT INTO legal_documents (
                    id, job_id, document_title, json_content, snapshot_r2_key, artifact_r2_key, pdf_sha256, created_at
                ) VALUES (
                    'doc-seed-nd123',
                    'job-seed-nd123',
                    'Nghị định 123/2021/NĐ-CP sửa đổi bổ sung Nghị định 100/2019/NĐ-CP',
                    ?,
                    'snapshots/nd123.pdf',
                    'snapshots/nd123.extracted.json',
                    'sha256-nd123',
                    datetime('now')
                )
            `).bind(JSON.stringify(docA)).run();

            const res = await service.searchLegalDocuments({
                query: "xử phạt vi phạm giao thông đường bộ",
            });

            // Must preserve both candidates and indicate AMBIGUOUS without forcing top-1
            expect(res.candidates.length).toBeGreaterThanOrEqual(2);
            expect(res.status).toBe("AMBIGUOUS");

            // Verify both candidates have candidate_id and neither has canonical_document_id forced
            for (const cand of res.candidates) {
                expect(cand.identity_type).toBe("CORPUS_DOCUMENT");
                expect(cand.canonical_document_id).toBeNull();
            }
        });

        it("never equates Job ID or Snapshot ID with canonical Document ID", async () => {
            const res = await service.searchLegalDocuments({
                query: "100/2019/NĐ-CP",
            });

            expect(res.candidates.length).toBeGreaterThan(0);
            const cand = res.candidates[0];

            expect(cand.candidate_id).toBe("doc-seed-nd100");
            expect(cand.source_provenance.job_id).toBe("job-seed-nd100");
            expect(cand.canonical_document_id).toBeNull();
            expect(cand.canonical_document_id).not.toBe(cand.source_provenance.job_id);
            expect(cand.canonical_document_id).not.toBe(cand.availability.snapshot_r2_key);
        });

        it("preserves source provenance and snapshot availability", async () => {
            const res = await service.searchLegalDocuments({
                query: "Nghị định 100/2019",
            });

            const cand = res.candidates[0];
            expect(cand.source_provenance.pdf_sha256).toBe("dummy-sha256");
            expect(cand.source_provenance.job_id).toBe("job-seed-nd100");
            expect(cand.availability.has_json_content).toBe(true);
            expect(cand.availability.has_pdf_snapshot).toBe(true);
            expect(cand.availability.snapshot_r2_key).toBe("snapshots/nd100.pdf");
        });
    });

    describe("Empty Corpus, Missing Metadata, and Input Validations", () => {
        it("returns EMPTY status with legal disclaimer when no documents match or corpus is empty", async () => {
            const res = await service.searchLegalDocuments({
                query: "văn bản không hề tồn tại trong kho lưu trữ xyz999",
            });

            expect(res.status).toBe("EMPTY");
            expect(res.total_candidates).toBe(0);
            expect(res.candidates).toEqual([]);
            expect(res.disclaimer).toContain("không chứng minh văn bản không tồn tại");
        });

        it("explains missing metadata without fabricating fake data", async () => {
            // Seed a document with minimalist title and no agency/date
            const rawDoc = {
                document_title: "Công văn hướng dẫn nội bộ",
                articles: [],
            };

            await db.prepare(`
                INSERT INTO legal_documents (
                    id, job_id, document_title, json_content, snapshot_r2_key, artifact_r2_key, pdf_sha256, created_at
                ) VALUES (
                    'doc-minimal',
                    'job-minimal',
                    'Công văn hướng dẫn nội bộ',
                    ?,
                    'snapshots/minimal.pdf',
                    'snapshots/minimal.extracted.json',
                    'sha256-minimal',
                    datetime('now')
                )
            `).bind(JSON.stringify(rawDoc)).run();

            const res = await service.searchLegalDocuments({
                query: "Công văn hướng dẫn nội bộ",
            });

            const cand = res.candidates.find((c) => c.candidate_id === "doc-minimal");
            expect(cand).toBeDefined();
            expect(cand?.document_number).toBeNull();
            expect(cand?.agency).toBeNull();
            expect(cand?.metadata_notes).toBeDefined();
            expect(cand?.metadata_notes).toContain("Số hiệu văn bản không hiển thị rõ");
        });

        it("rejects invalid query, negative limits, and bad date formats", async () => {
            await expect(
                service.searchLegalDocuments({
                    query: "   ",
                })
            ).rejects.toThrow("Search query string is required");

            await expect(
                service.searchLegalDocuments({
                    query: "Nghị định",
                    limit: -5,
                })
            ).rejects.toThrow("positive integer between 1 and 50");

            await expect(
                service.searchLegalDocuments({
                    query: "Nghị định",
                    limit: 100,
                })
            ).rejects.toThrow("limit cannot exceed maximum of 50");

            await expect(
                service.searchLegalDocuments({
                    query: "Nghị định",
                    issued_from: "2020/01/01", // Wrong format
                })
            ).rejects.toThrow("Date format must be YYYY-MM-DD");
        });
    });

    describe("Reverse Discovery & Resolver Handoff Fixture (Req 9)", () => {
        it("simulates document mention extraction -> search candidates -> handoff to backend resolver without auto-persisting relations", async () => {
            // Given: An extraction task processes an incoming document mentioning legal authorities
            const incomingExtractionSnippet =
                "Căn cứ Nghị định số 100/2019/NĐ-CP của Chính phủ về xử phạt vi phạm hành chính trong lĩnh vực giao thông đường bộ;";

            // Step 1: Preprocessing pipeline discovers legal authority candidate via search_legal_documents
            const searchResult = await service.searchLegalDocuments({
                query: incomingExtractionSnippet,
                document_number: "100/2019/NĐ-CP",
                agency: "Chính phủ",
            });

            expect(searchResult.candidates.length).toBeGreaterThan(0);
            const observedCandidate = searchResult.candidates[0];

            // Verify candidate observation properties
            expect(observedCandidate.candidate_id).toBe("doc-seed-nd100");
            expect(observedCandidate.title).toBe("Nghị định 100/2019/NĐ-CP");
            expect(observedCandidate.canonical_document_id).toBeNull(); // Candidate observation only

            // Step 2: Handoff candidate observation to backend relation resolver function
            interface ResolvedRelationObservation {
                source_mention: string;
                candidate_id: string;
                target_document_number: string;
                confidence: number;
                status: "PENDING_CANONICAL_CONFIRMATION";
            }

            function backendRelationResolver(candidate: typeof observedCandidate): ResolvedRelationObservation {
                // Backend resolver evaluates candidates independently from search tool
                return {
                    source_mention: incomingExtractionSnippet,
                    candidate_id: candidate.candidate_id,
                    target_document_number: candidate.document_number ?? "UNKNOWN",
                    confidence: candidate.match_score,
                    status: "PENDING_CANONICAL_CONFIRMATION",
                };
            }

            const observation = backendRelationResolver(observedCandidate);
            expect(observation.candidate_id).toBe("doc-seed-nd100");
            expect(observation.target_document_number).toBe("100/2019/NĐ-CP");
            expect(observation.status).toBe("PENDING_CANONICAL_CONFIRMATION");

            // Step 3: Assert that NO document relations or graph nodes were auto-persisted in DB
            // (Only legal_documents, processing_jobs, vocab_entries, vocab_metadata exist in schema)
            const countEntries = await db.prepare("SELECT count(*) as c FROM vocab_entries").first<{ c: number }>();
            expect(countEntries?.c).toBe(0); // Search tool creates no mutations or graph relations
        });
    });
});

describe("search_legal_documents on an LLM-extracted decree", () => {
    const EXTRACTED_DECREE = {
        document_title: "NGHỊ ĐỊNH Quy định xử phạt vi phạm hành chính trong lĩnh vực giao thông đường bộ và đường sắt",
        content: "CHÍNH PHỦ\nCỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nSố: 100/2019/NĐ-CP\nHà Nội, ngày 30 tháng 12 năm 2019\nCăn cứ Luật Giao thông đường bộ ngày 13 tháng 11 năm 2008;",
        articles: [],
    };

    async function searchExtractedDecree(input: { query: string; document_number?: string }) {
        const db = createTestD1Database({ seedSampleDocument: false });
        await db
            .prepare(
                `INSERT INTO legal_documents (id, job_id, document_title, json_content, snapshot_r2_key, artifact_r2_key, pdf_sha256, created_at)
                 VALUES ('nd100-run', 'nd100-run', ?, ?, 'uploads/nd100-run/nd100.pdf', 'runs/nd100-run/validated.json', ?, datetime('now'))`
            )
            .bind(EXTRACTED_DECREE.document_title, JSON.stringify(EXTRACTED_DECREE), "c".repeat(64))
            .run();

        return new DocumentService(new DocumentRepository(db)).searchLegalDocuments(input);
    }

    it("reads the document number from the 'Số:' header line when the title has none", async () => {
        const result = await searchExtractedDecree({ query: "xử phạt", document_number: "100/2019/NĐ-CP" });

        expect(result.candidates.map((candidate) => candidate.document_number)).toEqual(["100/2019/NĐ-CP"]);
        expect(result.candidates[0].issued_at).toBe("2019-12-30");
    });

    it("does not offer a decree as a candidate for a law it only cites", async () => {
        const result = await searchExtractedDecree({ query: "Luật Giao thông đường bộ ngày 13 tháng 11 năm 2008" });

        expect(result.status).toBe("EMPTY");
    });
});
