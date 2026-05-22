---
"@kilocode/cli": patch
---

Accept `env` as an alias for `environment` in local MCP server configuration. Configurations using the more common `env` key (matching Docker, npm, and VS Code conventions) are now normalised on load instead of failing strict validation.
