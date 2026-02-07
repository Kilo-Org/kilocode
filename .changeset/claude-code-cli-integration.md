---
"kilo-code": minor
---

feat(claude-code): Replace OAuth with CLI subprocess integration

- Migrate Claude Code provider from OAuth-based streaming API to CLI subprocess approach (matching Cline)
- Force XML tool protocol for claude-code provider (CLI blocks native tool_use)
- Add all model ID formats (short aliases, intermediate, dated) for compatibility
- Always display actual cost from CLI for both subscription and API users
- Remove OAuth, rate limit dashboard, and related UI components
