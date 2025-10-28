---
"@kilocode/cli": patch
---

MCP operations were being auto-rejected in CI mode (autonomous mode) even when `autoApproval.mcp.enabled: true`, breaking GitHub Actions workflows and other autonomous operations that rely on MCP servers.

**Root Cause:** The extension sends MCP requests with the ask type set to the operation name (e.g., `"use_mcp_server"`, `"access_mcp_resource"`), but the approval decision logic only handled these as tool names within the `"tool"` ask type. This caused MCP requests to fall through to the default case and get auto-rejected.

The approval decision service uses a switch statement on `askType` to determine whether to auto-approve, auto-reject, or require manual approval:

```typescript
switch (askType) {
	case "tool": // handles tool names like "readFile", "writeFile"
	case "command": // handles command execution
	case "followup": // handles followup questions
	case "api_req_failed": // handles retry requests
	default: // ❌ MCP ask types fell here → auto-reject
}
```

Added explicit cases for MCP ask types to the switch statement:

```typescript
case "use_mcp_server":
case "access_mcp_resource":
    if (config.mcp?.enabled) {
        return { action: "auto-approve" }
    }
    return isCIMode ? { action: "auto-reject", ... } : { action: "manual" }
```

Also enhanced the tool handler to catch MCP operations sent as tool names (in case the extension changes format):

```typescript
if (tool === "use_mcp_tool" || tool === "use_mcp_server" || tool === "access_mcp_resource") {
	if (config.mcp?.enabled) {
		return { action: "auto-approve" }
	}
	// ... rejection logic
}
```

- **Chose explicit ask type handling** over mapping ask types to tool names (cleaner, respects extension's message format)
- **Kept both ask type and tool name handlers** for defense-in-depth (minimal overhead, prevents future breakage)
- **Removed verbose logging** to reduce noise while maintaining troubleshooting capability

| before                                                                                                                                       | after                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP operations auto-rejected in CI mode with error "Auto-rejected in CI mode"                                                                | MCP operations auto-approved when autoApproval.mcp.enabled: true                                                                            |
| <img width="1444" height="499" alt="before-the-fix" src="https://github.com/user-attachments/assets/57e5820d-196c-4138-8b3d-1f185fc1db56" /> | <img width="1506" height="717" alt="after-the-fix" src="https://github.com/user-attachments/assets/a165aa9c-0018-47e4-a274-fed056716407" /> |

1. Just `kilocode --auto "Review the PR #2 in X/X repo, use github mcp servers if needed"`
2. Configure MCP settings with GitHub MCP server
3. Set `autoApproval.mcp.enabled: true` in config

```bash
cat > ~/.kilocode/cli/config.json <<EOF
{
  "version": "1.0.0",
  "autoApproval": {
    "mcp": {
      "enabled": true
    }
  }
}
EOF

`kilocode --auto "Review the PR #2 in X/X repo, use github mcp servers if needed"`

```
