---
"@kilocode/cli": patch
---

The `websearch` tool now accepts a `provider` parameter (`"exa"` or `"parallel"`) so an agent can pick the backend that fits the question. Defaults to `"exa"` instead of round-robin per session. Exa is preferred for primary-source research (arXiv, vendor papers, model cards with deep content extraction); Parallel is preferred for specific facts, current pricing/comparisons, leaderboards, and compound questions that benefit from multi-query fan-out.