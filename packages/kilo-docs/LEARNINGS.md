# docs-sync learnings

Rules the docs-sync bot learned from maintainer corrections to its rolling pull request.
The bot reads this file at the start of every run and follows every rule below.

To unlearn a rule, delete its line and commit. The next run reads this file from the
branch, so the rule is gone from its input, and the deletion itself is a correction the
extraction step is instructed not to undo.

<!-- docs-sync:learnings:start -->
- Explain why a flag or option is needed, not just that it exists. <!-- id=explain-flag-purpose scope=edit source=comment:4046075608 date=2026-09-18 -->
- Link the relevant reference documentation when describing platform-specific actions or shortcuts so the mapping is obvious. <!-- id=link-related-reference-docs scope=edit source=comment:4044915525 date=2026-09-18 -->
- State which plans and billing periods a fee applies to, including whether it covers annual plans, renewals, or only new monthly purchases. <!-- id=scope-fee-by-plan scope=edit source=comment:4045668762 date=2026-09-18 -->
<!-- docs-sync:learnings:end -->
