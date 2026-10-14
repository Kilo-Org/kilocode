---
"@kilocode/cli": patch
"@kilocode/kilo-jetbrains": patch
---

Keep MCP sign-in from resetting

Automatic OAuth recovery no longer clears stored credentials another session just refreshed, and signing in to a remote MCP server now updates the authentication warning in every open session instead of only the one that started it. The optional MCP stream probe is also restricted to its own endpoint so it cannot rewrite OAuth metadata or token responses.
