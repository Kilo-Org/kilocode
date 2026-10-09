# Maintaining the migration plan

Keep the repository plan. It provides versioned detail that can change alongside implementation and tests; the GitHub issue remains the public entry point.

| Document | Owns | Update when |
|---|---|---|
| `migration-tracking/plans/kilo-opencode-v2-plan-progress.md` | Detailed capability inventory, behavior, destination and acceptance boundaries | A change adds behavior, closes a gap, or changes scope |
| GitHub #13750 body | Architecture, original phases, compact capability status and links to remaining work | A milestone or material status/decision changes |
| Subissues | Independently actionable remaining work, owner, dependencies and acceptance checklist | Work progresses or acceptance changes |
| Issue comments | Dated results, decisions, blockers and links to PRs/test evidence | A meaningful checkpoint occurs |
| `migration-tracking/test-plans/` | Reproducible acceptance procedures and recorded limitations | Verification procedures or results change |
| `migration-tracking/marker-audit/` | Source-to-destination mapping and rationale for removing or retaining patches | A mapped behavior or placement changes |
| `migration-tracking/plans/kilo-opencode-v2-working-log.md` | Historical working record | Append only when useful; do not treat old checkpoints as current status |

The detailed repository inventory is the reference for capability coverage. The issue summarizes it; do not maintain another expanded inventory in comments. A subissue completion must update affected repository rows and the parent summary, without implying adjacent capabilities are complete.

For each accepted milestone, update the detailed plan in the implementation PR, include acceptance evidence and outstanding limitations, then summarize the changed rows on GitHub. While a branch is unpublished, identify local-only evidence explicitly. Link milestone evidence to a commit when stable provenance matters.

Do not make a marker count into a completion score. “Ported”, “native equivalent” and “not needed” need source-backed rationale; behavioral acceptance remains separate. “Deferred” remains outstanding unless an explicit product decision removes it from scope. Refusing unsupported imports is safe import behavior, not parity for the refused feature.

Retain the working log for traceability, with a clear historical role. Do not copy its internal coordination or obsolete percentages into the public issue. This draft package does not rename or overwrite either existing plan.
