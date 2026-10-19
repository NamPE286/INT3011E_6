import { beforeEach, describe, expect, it } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { VocabularyRepository } from "../src/modules/vocabulary/vocabulary.repository";
import { VocabularyService } from "../src/modules/vocabulary/vocabulary.service";
import { createTestD1Database } from "./d1-test-db";

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
        await repository.insertEntry({
            canonical_id: "VEH_002",
            type: "VEHICLE",
            canonical_label: "xe ô tô",
            aliases: ["ô tô con", "xe con"],
        });

        await repository.insertEntry({
            canonical_id: "ACT_002",
            type: "ACTION",
            canonical_label: "vượt đèn đỏ",
            aliases: ["vượt đèn tín hiệu", "không chấp hành đèn tín hiệu"],
        });

        await repository.insertEntry({
            canonical_id: "ACT_001",
            type: "ACTION",
            canonical_label: "chạy quá tốc độ",
            aliases: ["vượt quá tốc độ quy định", "chạy nhanh quá tốc độ"],
        });

        await repository.insertEntry({
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
        await repository.insertEntry({
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

        await repository.setPersistedVersion(5);
        expect(await repository.getCurrentVersion()).toBe(5);

        const snapshot = await service.getSnapshot();
        expect(snapshot.vocabulary_version).toBe(5);
    });

    it("supports atomic version increment in metadata table", async () => {
        const initialVersion = await repository.getCurrentVersion();
        const bumpedVersion = await repository.incrementVersion();

        expect(bumpedVersion).toBe(initialVersion + 1);
        expect(await repository.getCurrentVersion()).toBe(initialVersion + 1);
    });

    it("returns NOT_MODIFIED and empty entries when client version matches current version (cache hit)", async () => {
        await repository.insertEntry({
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
        await repository.insertEntry({
            canonical_id: "ACT_001",
            type: "ACTION",
            canonical_label: "đỗ xe",
            aliases: [],
        });

        await repository.setPersistedVersion(2);

        const outdatedSnapshot = await service.getSnapshot(1);
        expect(outdatedSnapshot.status).toBe("OK");
        expect(outdatedSnapshot.not_modified).toBe(false);
        expect(outdatedSnapshot.vocabulary_version).toBe(2);
        expect(outdatedSnapshot.entries.length).toBe(1);
    });
});
