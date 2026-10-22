# docs-sync learnings

Rules the docs-sync bot learned from maintainer corrections to its rolling pull request.
The bot reads this file at the start of every run and follows every rule below.

To unlearn a rule, delete its line and commit. The next run reads this file from the
branch, so the rule is gone from its input, and the deletion itself is a correction the
extraction step is instructed not to undo.

<!-- docs-sync:learnings:start -->
- Explain why a required flag or option is needed rather than only stating that it is required. <!-- id=explain-required-flags scope=edit source=comment:4046075608 date=2026-09-18 -->
- Note when items created before a behavior change, such as older links or shares, may need to be retried. <!-- id=document-legacy-link-retries scope=edit source=comment:4053112613 date=2026-09-19 -->
- Link each listed item to the source change it documents when the introduction promises such references. <!-- id=fulfill-promised-references scope=edit source=comment:4053902533 date=2026-09-19 -->
<!-- docs-sync:learnings:end -->
