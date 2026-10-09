# Kilo marker audits

Start with the [current v2 shared-change inventory](v2-current-shared-change-inventory.md) to review modifications to upstream-owned files. It includes clickable source/marker links and the metadata exceptions that a marker-only search misses.

| Document | Purpose |
|---|---|
| [Current v2 shared changes](v2-current-shared-change-inventory.md) | Upstream-diff inventory after marker coverage cleanup: 54 shared paths, 52 marked, 2 metadata exceptions. |
| [Shared source footprint](v2-shared-source-footprint-2026-09-10.md) | The narrower 24-production-source-file footprint and annotation rules. |
| [Historical marker inventory](kilo-override-marker-inventory.md) | Original pre-cleanup search; historical counts and line numbers are preserved. |
| [V1 port assessment](v1-kilo-marker-port-assessment.md) / [TSV](v1-kilo-marker-port-assessment.tsv) | 816 pinned v1 files / 6,128 occurrences, classified by behavior and destination. Not a current v2 marker count. |

Kilo-owned implementations intentionally do not carry patch markers. The v1 assessment’s 65 “already ported” files are a source-assessment category, not the number of modified upstream v2 files. Keep historical assessments intact; refresh the current inventory when shared changes move or annotations change.
