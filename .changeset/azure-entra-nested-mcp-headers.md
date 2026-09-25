---
"@kilocode/cli": patch
"kilo-code": patch
---

Support Azure Entra ID sign-in with a resource name or full endpoint URL, including when the value comes from the connect dialog instead of `AZURE_RESOURCE_NAME`. Also block variable references in project MCP headers nested under `mcp.servers`.
