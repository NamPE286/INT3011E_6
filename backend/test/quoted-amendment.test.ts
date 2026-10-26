import { describe, expect, it } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { buildChangeGraph, getDocumentChanges } from "../src/modules/changes/change.service";
import { buildDocumentGraph } from "../src/modules/documents/document-graph.service";
import { getViolationHistory, refreshHistory } from "../src/modules/history/history.service";
import { resolveDocumentIdentities } from "../src/modules/identity/identity.service";
import { listProvisions } from "../src/modules/provisions/provision.repository";
import { extractViolationRules, getViolationRules } from "../src/modules/violations/violation.service";
import { createTestD1Database } from "./d1-test-db";
import { BASE_DECREE, storeLegalDocument, type FixtureDocument } from "./legal-fixtures";

const OPTIONS = { model: "test-model" };

/** An amendment as the quote-aware assembler stores it: the new khoản 5 is `quoted` under its instruction. */
const QUOTED_AMENDMENT: FixtureDocument = {
    id: "nd-123-2021",
    title: "NGHỊ ĐỊNH Sửa đổi, bổ sung một số điều của các Nghị định quy định xử phạt vi phạm hành chính",
    content: "CHÍNH PHỦ\nSố: 123/2021/NĐ-CP\nHà Nội, ngày 28 tháng 12 năm 2021",
    articles: [
        {
            number: "2",
            title: "Sửa đổi, bổ sung một số điều của Nghị định số 100/2019/NĐ-CP ngày 30 tháng 12 năm 2019 của Chính phủ",
            clauses: [
                {
                    number: "10",
                    content: "Sửa đổi, bổ sung khoản 5 Điều 5 như sau:",
                    quoted: [
                        {
                            kind: "clause",
                            number: "5",
                            content: "Phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:",
                            children: [
                                { kind: "point", number: "a", content: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;" },
                                { kind: "point", number: "b", content: "Không chấp hành hiệu lệnh, hướng dẫn của người điều khiển giao thông hoặc người kiểm soát giao thông.”." },
                            ],
                        },
                    ],
                },
            ],
        },
        { number: "5", title: "Hiệu lực thi hành", clauses: [{ number: "1", content: "Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2022." }] },
    ],
};

async function importDocument(db: D1Database, fixture: FixtureDocument): Promise<void> {
    await storeLegalDocument(db, fixture);
    await buildDocumentGraph(db, fixture.id);
    await buildChangeGraph(db, fixture.id);
    await extractViolationRules(db, fixture.id, OPTIONS);
    await resolveDocumentIdentities(db, fixture.id, OPTIONS);
    await refreshHistory(db);
}

describe("quoted amendments stored by the assembler", () => {
    it("flow from the instruction to provisions, provision relations, placed rules and history", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, BASE_DECREE);
        await importDocument(db, QUOTED_AMENDMENT);

        const provisions = await listProvisions(db, QUOTED_AMENDMENT.id);
        const quotedPoint = provisions.find((provision) => provision.id === `${QUOTED_AMENDMENT.id}:dieu_2_khoan_10_q_khoan_5_diem_a`);

        expect(quotedPoint).toMatchObject({
            level: "POINT",
            contentRole: "QUOTED_NEW_TEXT",
            relevance: "VIOLATION_RULE",
            containerProvisionId: `${QUOTED_AMENDMENT.id}:dieu_2_khoan_10`,
        });

        const [instruction] = (await getDocumentChanges(db, QUOTED_AMENDMENT.id)).instructions;

        expect(instruction.relations[0]).toMatchObject({ relationType: "AMENDS", toProvisionId: `${BASE_DECREE.id}:dieu_5_khoan_5` });
        expect(instruction.newTextProvisionIds).toContain(`${QUOTED_AMENDMENT.id}:dieu_2_khoan_10_q_khoan_5`);

        const { rules } = await getViolationRules(db, QUOTED_AMENDMENT.id);
        const redLight = rules.find((rule) => rule.governedProvisionId === `${BASE_DECREE.id}:dieu_5_khoan_5_diem_a`);

        expect(rules).toHaveLength(2);
        expect(redLight?.sanction.fine).toMatchObject({ min: 4_000_000, max: 6_000_000 });

        const history = await getViolationHistory(db, redLight?.trafficViolationId ?? "");
        const [event] = history.lineages[0].changeEvents;

        expect(history.lineages[0].rules.map((entry) => entry.status)).toEqual(["AMENDED", "CURRENT"]);
        expect(event.changeTypes).toContain("SANCTION_INCREASE");
    });
});
