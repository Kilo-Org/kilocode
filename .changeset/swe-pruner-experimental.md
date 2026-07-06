---
"@kilocode/cli": minor
"@kilocode/sdk": minor
---

Add experimental SWE-Pruner support (disabled by default). When enabled via `experimental.swe_pruner` or the Experimental settings tab in VS Code, the read and grep tools accept an optional `context_focus_question` parameter; when the agent provides it, large tool outputs are pruned by a small model down to the lines relevant to that question, with omitted sections marked inline and a `SWE-Pruner · kept/total` indicator on the tool row. The skimming model can be overridden via `experimental.swe_pruner_model` (defaults to the configured small model). Any pruning failure falls back to the full output.
