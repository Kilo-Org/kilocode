---
"@kilocode/cli": patch
---

Make `KILO_DISABLE_PROJECT_CONFIG` also skip legacy Kilo Code project files (`.kilocode/mcp.json`, `.kilocode/rules`, `.kilocoderules`, `.kilocodemodes`, `.kilocode/workflows`, `.kilocodeignore`), while global rules, modes, workflows and MCP settings still load.
