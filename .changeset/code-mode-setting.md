---
"@kilocode/cli": patch
"kilo-code": patch
---

Add an experimental Programmatic Tool Calling setting under Settings > Experimental. When enabled, the agent calls MCP tools from a confined JavaScript program and discovers tools on demand, so fewer MCP tool definitions are sent to the model. The `KILO_EXPERIMENTAL_CODE_MODE` environment variable still enables it.
