# docs-sync learnings

Rules the docs-sync bot learned from maintainer corrections to its rolling pull request.
The bot reads this file at the start of every run and follows every rule below.

To unlearn a rule, delete its line and commit. The next run reads this file from the
branch, so the rule is gone from its input, and the deletion itself is a correction the
extraction step is instructed not to undo.

<!-- docs-sync:learnings:start -->
<!-- docs-sync:learnings:end -->
