# Core - Auto-Approval Feature

**Quick Navigation for AI Agents**

---

## Overview

Automatic approval system for tool executions. Allows certain operations to proceed without user confirmation based on rules and thresholds.

**Source Location**: `src/core/auto-approval/`

---

## Components

| Component | Type | File |
|-----------|------|------|
| AutoApprovalHandler | Class | `AutoApprovalHandler.ts` |
| commands | Functions | `commands.ts` (13KB) |
| tools | Functions | `tools.ts` |
| mcp | Functions | `mcp.ts` |

---

## Quick Reference

| Operation | Method | File |
|-----------|--------|------|
| Check approval | `shouldAutoApprove()` | `AutoApprovalHandler.ts` |
| Auto-approve command | `autoApproveCommand()` | `commands.ts` |
| Auto-approve tool | `autoApproveTool()` | `tools.ts` |

---

## Auto-Approval Rules

- **Read operations**: Usually auto-approved
- **Write operations**: Require explicit rules
- **Commands**: Based on command patterns
- **MCP tools**: Based on server trust

---

## Configuration

Users can configure:
- Which tools to auto-approve
- Command patterns to allow
- Maximum auto-approvals per session
- Trusted MCP servers

---

## Related

- [Tools](../tools/) - Tools check auto-approval
- [Task](../task/) - Tasks use auto-approval

---

[← Back to Core](../../Feature-Index.md)
