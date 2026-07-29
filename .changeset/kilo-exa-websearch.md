---
"@kilocode/cli": patch
---

Route the websearch tool's Exa requests through the Kilo proxy when signed into Kilo. The MCP-Exa transport is preserved as a fallback for users who set `EXA_API_KEY` or are not authenticated. A new `KILO_WEBSEARCH_PROVIDER=kilo-exa` env override forces the Kilo proxy path. Results are capped at 10.
