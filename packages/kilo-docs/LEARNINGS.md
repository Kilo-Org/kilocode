# docs-sync learnings

Rules the docs-sync bot learned from maintainer corrections to its rolling pull request.
The bot reads this file at the start of every run and follows every rule below.

To unlearn a rule, delete its line and commit. The next run reads this file from the
branch, so the rule is gone from its input, and the deletion itself is a correction the
extraction step is instructed not to undo.

<!-- docs-sync:learnings:start -->
- State the full scope of any fee or charge, including whether it applies to renewals as well as new purchases. <!-- id=specify-fee-scope scope=edit source=comment:4043925902 date=2026-09-18 -->
<!-- docs-sync:learnings:end -->
