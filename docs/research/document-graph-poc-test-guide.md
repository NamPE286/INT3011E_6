# Test guide: Evidence-backed legal document relation graph (PoC)

## 1. Scope of this PoC

The current implementation is a **rule-based candidate extractor**, not a complete legal graph.
It scans Vietnamese text for relation cues, finds a referenced legal instrument in the same sentence,
and stores the exact evidence quote and character offsets. Every output starts with status
`UNRESOLVED`; do not treat it as a verified legal relation without identity resolution and human review.

## 2. Files

- `backend/src/modules/documents/document-graph.types.ts`: relation, evidence, candidate and result types.
- `backend/src/modules/documents/document-graph.extractor.ts`: phrase-based candidate extraction.
- `backend/src/modules/documents/document-graph.extractor.test.ts`: automated unit tests.
- `docs/research/document-graph-build.md`: broader design and evaluation plan.

## 3. Run tests locally

Prerequisites: Git, Bun, and the repository cloned locally.

From the repository root:

```bash
git fetch origin
git switch --track origin/feature/document-relation-schema
cd backend
bun install
bun test src/modules/documents/document-graph.extractor.test.ts
bun run typecheck
```

If you already created the local branch, use `git switch feature/document-relation-schema` instead.
Run the full backend test suite with `bun test`.

**Expected result:** all extractor tests pass and `bun run typecheck` exits successfully.
If a command fails, keep the complete error output; do not count a failing run as a pass.

## 4. Manual smoke test

Create a temporary test file under `backend/` named `try-document-graph.ts`:

```ts
import { extractDocumentRelationCandidates } from "./src/modules/documents/document-graph.extractor";

const text =
  "Nghị định số 12/2024/NĐ-CP sửa đổi, bổ sung một số điều của Nghị định số 100/2019/NĐ-CP.";

console.dir(
  extractDocumentRelationCandidates({
    source_document_id: "sample-source",
    text,
  }),
  { depth: null },
);
```

Run it from `backend/`:

```bash
bun run try-document-graph.ts
```

Inspect the output. At least one candidate should have:
- `relation_type: "AMENDS_OR_SUPPLEMENTS"`
- `target_document_number: "100/2019/NĐ-CP"` (the affected document, not the amending document)
- `status: "UNRESOLVED"`
- an evidence quote that is exactly equal to `text.slice(evidence.start, evidence.end)`

Delete the temporary file after testing.

## 5. How to evaluate whether the topic is correct

Unit tests show that known examples behave as expected; they do **not** prove that extraction is accurate on real legislation.
Build a small gold dataset from real documents and have a person familiar with Vietnamese legal texts label each relation:

| Field | What to record |
| --- | --- |
| Source document | Stable ID of the document containing the relation |
| Target document | Verified canonical ID/number, or unresolved |
| Relation type | For example, amends, repeals, legal basis |
| Evidence | Exact sentence or text span supporting the relation |
| Review status | Accepted, rejected, or ambiguous |

Compare extractor candidates with this independently labelled dataset:
- **Precision** = correct extracted relations / all extracted relations.
- **Recall** = correct extracted relations / all relations in the gold dataset.
- **F1** = harmonic mean of precision and recall.
- Also report target-resolution accuracy, evidence-span correctness, and counts of false positives/false negatives.

Split evaluation examples by source document, not by sentence from the same document, to reduce leakage. Record the dataset version and review decisions. Set acceptance thresholds with the project supervisor/team before claiming success.

## 6. Known limitations

- Phrase rules cover only a small set of common expressions and document types.
- Legal references can be ambiguous, incomplete, or written in historical formats.
- One sentence may mention several documents, and the cue may not establish which one is legally affected.
- Negation, exceptions, context across sentences, OCR errors, and legal-effect dates are not fully handled.
- This PoC does not fetch source documents, resolve canonical IDs, persist graph edges, or expose an API.
- Do not publish the candidate list as authoritative legal advice or a verified legal graph.

A next step after this baseline passes tests is to add a curated gold dataset, improve reference parsing/resolution, and only then connect reviewed candidates to persistence.
