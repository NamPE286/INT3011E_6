import { beforeEach, describe, expect, it } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { VocabularyRepository } from "../src/modules/vocabulary/vocabulary.repository";
import { VocabularyService } from "../src/modules/vocabulary/vocabulary.service";
import { createTestD1Database } from "./d1-test-db";
import { insertVocabEntry, setVocabularyVersion } from "./vocab-fixtures";

describe("VocabularyRepository and VocabularyService", () => {
    let db: D1Database;
    let repository: VocabularyRepository;
    let service: VocabularyService;

    beforeEach(() => {
        db = createTestD1Database();
        repository = new VocabularyRepository(db);
        service = new VocabularyService(repository);
    });

    it("returns initial persisted vocabulary version and empty entries with status OK when empty", async () => {
        const snapshot = await service.getSnapshot();

        expect(snapshot.status).toBe("OK");
        expect(snapshot.not_modified).toBe(false);
        expect(snapshot.vocabulary_version).toBe(1);
        expect(snapshot.entries).toEqual([]);
    });

    it("returns deterministic ordering by type and canonical_id", async () => {
        await insertVocabEntry(db, {
            canonical_id: "VEH_002",
            type: "VEHICLE",
            canonical_label: "xe ô tô",
            aliases: ["ô tô con", "xe con"],
        });

        await insertVocabEntry(db, {
            canonical_id: "ACT_002",
            type: "ACTION",
            canonical_label: "vượt đèn đỏ",
            aliases: ["vượt đèn tín hiệu", "không chấp hành đèn tín hiệu"],
        });

        await insertVocabEntry(db, {
            canonical_id: "ACT_001",
            type: "ACTION",
            canonical_label: "chạy quá tốc độ",
            aliases: ["vượt quá tốc độ quy định", "chạy nhanh quá tốc độ"],
        });

        await insertVocabEntry(db, {
            canonical_id: "TARGET_001",
            type: "TARGET",
            canonical_label: "người đi bộ",
            aliases: ["khách bộ hành"],
        });

        const snapshot = await service.getSnapshot();

        expect(snapshot.status).toBe("OK");
        expect(snapshot.not_modified).toBe(false);
        expect(snapshot.entries.length).toBe(4);
        expect(snapshot.entries[0].canonical_id).toBe("ACT_001");
        expect(snapshot.entries[1].canonical_id).toBe("ACT_002");
        expect(snapshot.entries[2].canonical_id).toBe("TARGET_001");
        expect(snapshot.entries[3].canonical_id).toBe("VEH_002");
    });

    it("sorts entry aliases alphabetically for deterministic serialization", async () => {
        await insertVocabEntry(db, {
            canonical_id: "ACT_001",
            type: "ACTION",
            canonical_label: "chuyển hướng",
            aliases: ["rẽ", "quay đầu", "đổi làn"],
        });

        const snapshot = await service.getSnapshot();

        expect(snapshot.entries.length).toBe(1);
        expect(snapshot.entries[0].aliases).toEqual(["đổi làn", "quay đầu", "rẽ"]);
    });

    it("reads and updates persisted version in metadata", async () => {
        expect(await repository.getCurrentVersion()).toBe(1);

        await setVocabularyVersion(db, 5);
        expect(await repository.getCurrentVersion()).toBe(5);

        const snapshot = await service.getSnapshot();
        expect(snapshot.vocabulary_version).toBe(5);
    });

    it("returns NOT_MODIFIED and empty entries when client version matches current version (cache hit)", async () => {
        await insertVocabEntry(db, {
            canonical_id: "ACT_001",
            type: "ACTION",
            canonical_label: "dừng xe",
            aliases: [],
        });

        const fullSnapshot = await service.getSnapshot();
        expect(fullSnapshot.status).toBe("OK");
        expect(fullSnapshot.not_modified).toBe(false);
        expect(fullSnapshot.entries.length).toBe(1);

        const cachedSnapshot = await service.getSnapshot(fullSnapshot.vocabulary_version);
        expect(cachedSnapshot.status).toBe("NOT_MODIFIED");
        expect(cachedSnapshot.not_modified).toBe(true);
        expect(cachedSnapshot.vocabulary_version).toBe(fullSnapshot.vocabulary_version);
        expect(cachedSnapshot.entries).toEqual([]);
    });

    it("returns full entries with status OK when client version is outdated or mismatched", async () => {
        await insertVocabEntry(db, {
            canonical_id: "ACT_001",
            type: "ACTION",
            canonical_label: "đỗ xe",
            aliases: [],
        });

        await setVocabularyVersion(db, 2);

        const outdatedSnapshot = await service.getSnapshot(1);
        expect(outdatedSnapshot.status).toBe("OK");
        expect(outdatedSnapshot.not_modified).toBe(false);
        expect(outdatedSnapshot.vocabulary_version).toBe(2);
        expect(outdatedSnapshot.entries.length).toBe(1);
    });

    describe("addVocab - Core statuses and lifecycle", () => {
        it("returns CREATED, increments version atomically, and stores provenance", async () => {
            const initialVersion = await repository.getCurrentVersion();
            expect(initialVersion).toBe(1);

            const result = await service.addVocab({
                type: "ACTION",
                canonical_label: "vượt đèn đỏ",
                aliases: ["không chấp hành tín hiệu đèn"],
                definition: "Hành vi không tuân thủ đèn tín hiệu giao thông",
                evidence: "Người điều khiển phương tiện không chấp hành hiệu lệnh của đèn tín hiệu giao thông",
                source_provision_id: "dieu_5_khoan_5_diem_a",
                base_vocabulary_version: 1,
            });

            expect(result.status).toBe("CREATED");
            expect(result.vocabulary_version).toBe(2);
            expect(result.canonical_id).toContain("ACT_");
            expect(result.entry?.canonical_label).toBe("vượt đèn đỏ");
            expect(result.entry?.aliases).toEqual(["không chấp hành tín hiệu đèn"]);

            // Version is updated in DB
            expect(await repository.getCurrentVersion()).toBe(2);

            // Record is in DB with provenance
            const all = await repository.getAllEntries();
            expect(all.length).toBe(1);
            expect(all[0].canonical_label).toBe("vượt đèn đỏ");
            expect(all[0].evidence).toBe(
                "Người điều khiển phương tiện không chấp hành hiệu lệnh của đèn tín hiệu giao thông"
            );
            expect(all[0].source_provision_id).toBe("dieu_5_khoan_5_diem_a");
            expect(all[0].vocabulary_version).toBe(2);

            // Snapshot reflects new entry and version
            const snapshot = await service.getSnapshot();
            expect(snapshot.vocabulary_version).toBe(2);
            expect(snapshot.entries.length).toBe(1);
            expect(snapshot.entries[0].canonical_label).toBe("vượt đèn đỏ");
        });

        it("returns EXISTING when proposed canonical_label matches existing entry exactly", async () => {
            await service.addVocab({
                type: "VEHICLE",
                canonical_label: "xe ô tô",
                aliases: ["xe con"],
                evidence: "Phương tiện giao thông cơ giới đường bộ gồm xe ô tô",
                source_provision_id: "dieu_3_khoan_1",
                base_vocabulary_version: 1,
            });

            const dupResult = await service.addVocab({
                type: "VEHICLE",
                canonical_label: "Xe Ô Tô", // case variation
                aliases: ["ô tô con"],
                evidence: "Người điều khiển xe ô tô vi phạm",
                source_provision_id: "dieu_5_khoan_1",
                base_vocabulary_version: 2,
            });

            expect(dupResult.status).toBe("EXISTING");
            expect(dupResult.vocabulary_version).toBe(2);
            expect(dupResult.canonical_id).toContain("VEH_");
            expect(dupResult.entry?.canonical_label).toBe("xe ô tô");

            // Database count unchanged (no duplicate row)
            const all = await repository.getAllEntries();
            expect(all.length).toBe(1);
            expect(await repository.getCurrentVersion()).toBe(2);
        });

        it("returns EXISTING when proposed canonical_label matches an existing alias", async () => {
            await service.addVocab({
                type: "ACTION",
                canonical_label: "chuyển hướng xe",
                aliases: ["rẽ xe", "quay đầu xe"],
                evidence: "Khi chuyển hướng xe, người điều khiển phải giảm tốc độ",
                source_provision_id: "dieu_15_khoan_1",
                base_vocabulary_version: 1,
            });

            const dupResult = await service.addVocab({
                type: "ACTION",
                canonical_label: "rẽ xe",
                evidence: "Người lái xe rẽ xe không bật đèn tín hiệu",
                source_provision_id: "dieu_15_khoan_2",
                base_vocabulary_version: 2,
            });

            expect(dupResult.status).toBe("EXISTING");
            expect(dupResult.entry?.canonical_label).toBe("chuyển hướng xe");
            expect(await repository.getCurrentVersion()).toBe(2);

            const all = await repository.getAllEntries();
            expect(all.length).toBe(1);
        });

        it("returns AMBIGUOUS and does not insert when alias collides with a different existing entry", async () => {
            await service.addVocab({
                type: "VEHICLE",
                canonical_label: "xe mô tô",
                aliases: ["xe máy"],
                evidence: "Xe mô tô hai bánh, ba bánh",
                source_provision_id: "dieu_3_khoan_2",
                base_vocabulary_version: 1,
            });

            // Propose new vehicle, but its alias claims 'xe máy' which belongs to 'xe mô tô'
            const ambResult = await service.addVocab({
                type: "VEHICLE",
                canonical_label: "xe gắn máy",
                aliases: ["xe máy", "xe đạp điện"],
                evidence: "Xe gắn máy có vận tốc thiết kế không quá 50km/h",
                source_provision_id: "dieu_3_khoan_3",
                base_vocabulary_version: 2,
            });

            expect(ambResult.status).toBe("AMBIGUOUS");
            expect(ambResult.vocabulary_version).toBe(2);
            expect(ambResult.existing_entries?.length).toBeGreaterThanOrEqual(1);
            expect(ambResult.conflicts?.length).toBeGreaterThan(0);

            // DB unchanged: no new row, version unchanged
            const all = await repository.getAllEntries();
            expect(all.length).toBe(1);
            expect(await repository.getCurrentVersion()).toBe(2);
        });

        it("returns AMBIGUOUS when proposed label has high textual similarity to an existing entry", async () => {
            await service.addVocab({
                type: "ACTION",
                canonical_label: "chạy quá tốc độ",
                aliases: ["vượt tốc độ"],
                evidence: "Điều khiển xe chạy quá tốc độ quy định",
                source_provision_id: "dieu_5_khoan_3",
                base_vocabulary_version: 1,
            });

            // Near duplicate phrasing: "chạy xe quá tốc độ" vs "chạy quá tốc độ"
            const similarResult = await service.addVocab({
                type: "ACTION",
                canonical_label: "chạy xe quá tốc độ",
                evidence: "Người lái xe chạy xe quá tốc độ",
                source_provision_id: "dieu_6_khoan_1",
                base_vocabulary_version: 2,
            });

            expect(similarResult.status).toBe("AMBIGUOUS");
            expect(similarResult.existing_entries?.[0].canonical_label).toBe("chạy quá tốc độ");
            expect(similarResult.conflicts?.[0]).toContain("similarity");

            // DB unchanged
            const all = await repository.getAllEntries();
            expect(all.length).toBe(1);
            expect(await repository.getCurrentVersion()).toBe(2);
        });

        it("returns STALE_VERSION and does not insert when client version is outdated", async () => {
            // Version is 1
            await setVocabularyVersion(db, 3);

            const staleResult = await service.addVocab({
                type: "LOCATION",
                canonical_label: "đường cao tốc",
                evidence: "Đường cao tốc là đường dành cho xe cơ giới chạy tốc độ cao",
                source_provision_id: "dieu_26_khoan_1",
                base_vocabulary_version: 1, // outdated version!
            });

            expect(staleResult.status).toBe("STALE_VERSION");
            expect(staleResult.vocabulary_version).toBe(3);
            expect(staleResult.message).toContain("stale");

            // No entry inserted
            const all = await repository.getAllEntries();
            expect(all.length).toBe(0);
            expect(await repository.getCurrentVersion()).toBe(3);
        });
    });

    describe("addVocab - Input validation and Provenance protection", () => {
        it("rejects blank or invalid canonical_label", async () => {
            await expect(
                service.addVocab({
                    type: "ACTION",
                    canonical_label: "   ",
                    evidence: "Hành vi vi phạm giao thông",
                    source_provision_id: "dieu_5",
                    base_vocabulary_version: 1,
                })
            ).rejects.toThrow("canonical_label");
        });

        it("rejects invalid vocabulary type", async () => {
            await expect(
                service.addVocab({
                    type: "INVALID_TYPE" as any,
                    canonical_label: "xe cộ",
                    evidence: "Hành vi vi phạm giao thông",
                    source_provision_id: "dieu_5",
                    base_vocabulary_version: 1,
                })
            ).rejects.toThrow("Invalid vocabulary type");
        });

        it("rejects missing, empty, or placeholder evidence", async () => {
            await expect(
                service.addVocab({
                    type: "ACTION",
                    canonical_label: "vượt tốc độ",
                    evidence: "   ",
                    source_provision_id: "dieu_5",
                    base_vocabulary_version: 1,
                })
            ).rejects.toThrow("Legal evidence text");

            await expect(
                service.addVocab({
                    type: "ACTION",
                    canonical_label: "vượt tốc độ",
                    evidence: "abc",
                    source_provision_id: "dieu_5",
                    base_vocabulary_version: 1,
                })
            ).rejects.toThrow("at least 5 characters");

            await expect(
                service.addVocab({
                    type: "ACTION",
                    canonical_label: "vượt tốc độ",
                    evidence: "none",
                    source_provision_id: "dieu_5",
                    base_vocabulary_version: 1,
                })
            ).rejects.toThrow("Placeholder");
        });

        it("rejects ephemeral Job ID as stable Provision ID", async () => {
            // UUID job ID
            await expect(
                service.addVocab({
                    type: "ACTION",
                    canonical_label: "vượt tốc độ",
                    evidence: "Người điều khiển phương tiện vượt quá tốc độ",
                    source_provision_id: "550e8400-e29b-41d4-a716-446655440000",
                    base_vocabulary_version: 1,
                })
            ).rejects.toThrow("Job ID or Snapshot ID cannot be used as stable Provision ID");

            // Prefix job- ID
            await expect(
                service.addVocab({
                    type: "ACTION",
                    canonical_label: "vượt tốc độ",
                    evidence: "Người điều khiển phương tiện vượt quá tốc độ",
                    source_provision_id: "job-processing-98765",
                    base_vocabulary_version: 1,
                })
            ).rejects.toThrow("Job ID or Snapshot ID cannot be used as stable Provision ID");
        });

        it("rejects snapshot storage paths as stable Provision ID", async () => {
            await expect(
                service.addVocab({
                    type: "ACTION",
                    canonical_label: "vượt tốc độ",
                    evidence: "Người điều khiển phương tiện vượt quá tốc độ",
                    source_provision_id: "snapshots/job-123.pdf",
                    base_vocabulary_version: 1,
                })
            ).rejects.toThrow("Job ID or Snapshot ID cannot be used as stable Provision ID");
        });

        it("rejects valid format provision ID that does not exist in legal documents", async () => {
            // "dieu_99" has valid provision format, but does not exist in seeded legal documents
            await expect(
                service.addVocab({
                    type: "ACTION",
                    canonical_label: "hành vi lạ",
                    evidence: "Người điều khiển phương tiện vi phạm quy tắc",
                    source_provision_id: "dieu_99",
                    base_vocabulary_version: 1,
                })
            ).rejects.toThrow("Provision 'dieu_99' not found in source legal documents");

            // Database count remains 0 (no CREATED allowed)
            const all = await repository.getAllEntries();
            expect(all.length).toBe(0);
        });

        it("rejects valid provision ID when evidence does not match source text", async () => {
            // "dieu_5_khoan_1" exists, but evidence text is fabricated / mismatched
            await expect(
                service.addVocab({
                    type: "ACTION",
                    canonical_label: "hành vi bịa đặt",
                    evidence: "Người lái tàu hỏa không kéo còi báo động khẩn cấp",
                    source_provision_id: "dieu_5_khoan_1",
                    base_vocabulary_version: 1,
                })
            ).rejects.toThrow("Legal evidence does not match text in provision 'dieu_5_khoan_1'");

            // Database count remains 0 (no CREATED allowed)
            const all = await repository.getAllEntries();
            expect(all.length).toBe(0);
        });
    });

    describe("addVocab - Concurrency and Duplicate Prevention", () => {
        it("prevents duplicates on concurrent calls with same input", async () => {
            const input = {
                type: "TARGET" as const,
                canonical_label: "dải phân cách",
                aliases: ["dải phân cách cứng"],
                evidence: "Đâm va vào dải phân cách trên đường bộ",
                source_provision_id: "dieu_5_khoan_1",
                base_vocabulary_version: 1,
            };

            const [res1, res2] = await Promise.all([
                service.addVocab(input),
                service.addVocab(input),
            ]);

            const statuses = [res1.status, res2.status].sort();
            expect(statuses).toEqual(["CREATED", "EXISTING"]);

            // Version is bumped exactly once to 2
            expect(await repository.getCurrentVersion()).toBe(2);

            // Exactly 1 record in database (no duplicates!)
            const all = await repository.getAllEntries();
            expect(all.length).toBe(1);
            expect(all[0].canonical_label).toBe("dải phân cách");
        });

        it("prevents two concurrent callers with same base version proposing two DIFFERENT new concepts from both succeeding", async () => {
            const inputA = {
                type: "ACTION" as const,
                canonical_label: "chuyển hướng xe",
                evidence: "Khi chuyển hướng xe, người điều khiển phải giảm tốc độ",
                source_provision_id: "dieu_15_khoan_1",
                base_vocabulary_version: 1,
            };

            const inputB = {
                type: "LOCATION" as const,
                canonical_label: "đường cao tốc",
                evidence: "Đường cao tốc là đường dành cho xe cơ giới chạy tốc độ cao",
                source_provision_id: "dieu_26_khoan_1",
                base_vocabulary_version: 1,
            };

            const [resA, resB] = await Promise.all([
                service.addVocab(inputA),
                service.addVocab(inputB),
            ]);

            const statuses = [resA.status, resB.status].sort();
            // Exactly one succeeds with CREATED, the other is rejected with STALE_VERSION!
            expect(statuses).toEqual(["CREATED", "STALE_VERSION"]);

            // Version is bumped exactly once to 2
            expect(await repository.getCurrentVersion()).toBe(2);

            // Exactly 1 concept was created in the database, NOT both!
            const all = await repository.getAllEntries();
            expect(all.length).toBe(1);
        });

        it("strictly prevents INSERT and leaves version untouched when optimistic UPDATE affects 0 rows", async () => {
            const initialVersion = await repository.getCurrentVersion();
            expect(initialVersion).toBe(1);

            // Attempt atomic insert with mismatching expectedBaseVersion (e.g. 99 instead of 1)
            await expect(
                repository.insertEntryAtomic(
                    {
                        canonical_id: "ACT_TEST_FAIL",
                        type: "ACTION",
                        canonical_label: "hành vi kiểm tra",
                        evidence: "Không thể chèn khi version sai",
                        source_provision_id: "dieu_5",
                    },
                    99 // Mismatch!
                )
            ).rejects.toThrow("STALE_VERSION_CONFLICT");

            // Verify INSERT was completely prevented: 0 rows inserted
            const allEntries = await repository.getAllEntries();
            expect(allEntries.length).toBe(0);

            // Verify metadata version was not modified or bumped
            const currentVersion = await repository.getCurrentVersion();
            expect(currentVersion).toBe(1);
        });

        it("disambiguates identical provision numbers across multiple legal documents using source_document_id or qualified provision ID", async () => {
            // Seed a second legal document in the database that ALSO contains Điều 5 Khoản 1
            const secondLegalDoc = {
                document_title: "Luật Trật tự an toàn giao thông đường bộ 2024",
                articles: [
                    {
                        number: "5",
                        title: "Các hành vi bị nghiêm cấm",
                        content: "Điều 5. Các hành vi bị nghiêm cấm",
                        clauses: [
                            {
                                number: "1",
                                title: null,
                                content: "Điều khiển phương tiện tham gia giao thông mà trong máu hoặc hơi thở có nồng độ cồn.",
                                points: [],
                            },
                        ],
                    },
                ],
            };

            await db.prepare(`
                INSERT INTO legal_documents (
                    id, job_id, document_title, json_content, snapshot_r2_key, artifact_r2_key, pdf_sha256, created_at
                ) VALUES (
                    'doc-seed-luat2024',
                    'job-seed-luat2024',
                    'Luật Trật tự an toàn giao thông đường bộ 2024',
                    ?,
                    'snapshots/luat2024.pdf',
                    'snapshots/luat2024.extracted.json',
                    'sha256-luat',
                    datetime('now')
                )
            `).bind(JSON.stringify(secondLegalDoc)).run();

            // Scenario 1: Target doc-seed-nd100, but evidence is from Luật 2024 -> MUST FAIL, NOT verify against Luật 2024
            await expect(
                service.addVocab({
                    type: "ACTION",
                    canonical_label: "vi phạm nồng độ cồn",
                    evidence: "Điều khiển phương tiện tham gia giao thông mà trong máu hoặc hơi thở có nồng độ cồn",
                    source_provision_id: "dieu_5_khoan_1",
                    source_document_id: "doc-seed-nd100", // Scoped to doc-seed-nd100!
                    base_vocabulary_version: 1,
                })
            ).rejects.toThrow("Legal evidence does not match text in provision 'dieu_5_khoan_1' in document 'doc-seed-nd100'");

            // Scenario 2: Use qualified ID "doc-seed-luat2024:dieu_5_khoan_1" -> verifies and associates with doc-seed-luat2024
            const res = await service.addVocab({
                type: "ACTION",
                canonical_label: "vi phạm nồng độ cồn",
                evidence: "Điều khiển phương tiện tham gia giao thông mà trong máu hoặc hơi thở có nồng độ cồn",
                source_provision_id: "doc-seed-luat2024:dieu_5_khoan_1",
                base_vocabulary_version: 1,
            });

            expect(res.status).toBe("CREATED");
            expect(res.vocabulary_version).toBe(2);

            // Verify persisted record is bound to the exact document
            const inserted = await repository.getEntryByCanonicalId(res.canonical_id!);
            expect(inserted).not.toBeNull();
            expect(inserted?.source_document_id).toBe("doc-seed-luat2024");

            // Scenario 3: Bare provision ID "dieu_5_khoan_1" is ambiguous because BOTH docs contain Điều 5 Khoản 1 -> MUST BE REJECTED
            await expect(
                service.addVocab({
                    type: "ACTION",
                    canonical_label: "vi phạm khác",
                    evidence: "Điều khiển phương tiện tham gia giao thông mà trong máu hoặc hơi thở có nồng độ cồn",
                    source_provision_id: "dieu_5_khoan_1", // Bare ID without document qualification!
                    base_vocabulary_version: 2,
                })
            ).rejects.toThrow("Ambiguous provision reference 'dieu_5_khoan_1'");
        });

        it("rolls back metadata version when INSERT fails due to constraint error in batch transaction, even under concurrent calls", async () => {
            const initialVersion = await repository.getCurrentVersion();
            expect(initialVersion).toBe(1);

            // Pre-seed an entry with fixed canonical_id
            await insertVocabEntry(db, {
                canonical_id: "ACT_FIXED_DUPLICATE",
                type: "ACTION",
                canonical_label: "hành vi cố định",
                aliases: [],
            });

            const countBefore = (await repository.getAllEntries()).length;

            // Attempt insert with the exact same canonical_id -> violates UNIQUE(canonical_id)
            await expect(
                repository.insertEntryAtomic(
                    {
                        canonical_id: "ACT_FIXED_DUPLICATE", // Trigger UNIQUE constraint failure!
                        type: "ACTION",
                        canonical_label: "hành vi trùng lặp",
                        evidence: "Bị lỗi trùng khóa",
                        source_provision_id: "dieu_5",
                    },
                    1 // Base version was valid, but insert fails
                )
            ).rejects.toThrow("UNIQUE constraint failed");

            // Verify transaction was rolled back: metadata version is NOT bumped to 2!
            expect(await repository.getCurrentVersion()).toBe(1);
            // Verify entries count has not increased
            expect((await repository.getAllEntries()).length).toBe(countBefore);

            // Concurrent test: 1 failing caller + 1 valid caller simultaneously
            const [failCall, validCall] = await Promise.allSettled([
                repository.insertEntryAtomic(
                    {
                        canonical_id: "ACT_FIXED_DUPLICATE", // Fails UNIQUE constraint
                        type: "ACTION",
                        canonical_label: "thử nghiệm lỗi",
                    },
                    1
                ),
                repository.insertEntryAtomic(
                    {
                        canonical_id: "ACT_VALID_CONCURRENT", // Valid!
                        type: "ACTION",
                        canonical_label: "hành vi hợp lệ",
                    },
                    1
                ),
            ]);

            expect(failCall.status).toBe("rejected");
            expect(validCall.status).toBe("fulfilled");

            // Valid caller cleanly bumped version from 1 to 2
            expect(await repository.getCurrentVersion()).toBe(2);
            const validRecord = await repository.getEntryByCanonicalId("ACT_VALID_CONCURRENT");
            expect(validRecord).not.toBeNull();
            expect(validRecord?.vocabulary_version).toBe(2);
        });
    });
});

