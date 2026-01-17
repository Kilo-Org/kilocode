# Core - Tools Feature

**Quick Navigation for AI Agents**

---

## Overview

30+ built-in tools for AI task execution. Tools handle file operations, code search, command execution, browser automation, and MCP integration.

**Source Location**: `src/core/tools/`

---

## Tool Categories

| Category | Tools | Documentation |
|----------|-------|---------------|
| **[File Tools](./file-tools/)** | ReadFile, WriteToFile, EditFile, SearchReplace | File operations |
| **[Diff/Patch Tools](./diff-patch-tools/)** | ApplyDiff, MultiApplyDiff, ApplyPatch | Code modifications |
| **[Search Tools](./search-tools/)** | CodebaseSearch, SearchFiles, ListFiles | Code search |
| **[Execution Tools](./execution-tools/)** | ExecuteCommand, RunSlashCommand | Shell commands |
| **[Browser Tools](./browser-tools/)** | BrowserAction | Browser automation |
| **[MCP Tools](./mcp-tools/)** | UseMcpTool, accessMcpResource | MCP integration |
| **[Task Tools](./task-tools/)** | AttemptCompletion, AskFollowup, NewTask | Task control |

---

## All Tools

| Tool | Category | File | Size |
|------|----------|------|------|
| ReadFileTool | File | `ReadFileTool.ts` | 32KB |
| WriteToFileTool | File | `WriteToFileTool.ts` | 11KB |
| EditFileTool | File | `EditFileTool.ts` | 12KB |
| SearchAndReplaceTool | File | `SearchAndReplaceTool.ts` | 9KB |
| ApplyDiffTool | Diff/Patch | `ApplyDiffTool.ts` | 11KB |
| MultiApplyDiffTool | Diff/Patch | `MultiApplyDiffTool.ts` | 28KB |
| ApplyPatchTool | Diff/Patch | `ApplyPatchTool.ts` | 15KB |
| CodebaseSearchTool | Search | `CodebaseSearchTool.ts` | 9KB |
| SearchFilesTool | Search | `SearchFilesTool.ts` | - |
| ListFilesTool | Search | `ListFilesTool.ts` | - |
| ExecuteCommandTool | Execution | `ExecuteCommandTool.ts` | 13KB |
| RunSlashCommandTool | Execution | `RunSlashCommandTool.ts` | 4KB |
| BrowserActionTool | Browser | `BrowserActionTool.ts` | 10KB |
| UseMcpToolTool | MCP | `UseMcpToolTool.ts` | 10KB |
| accessMcpResourceTool | MCP | `accessMcpResourceTool.ts` | 3KB |
| AttemptCompletionTool | Task | `AttemptCompletionTool.ts` | 8KB |
| AskFollowupQuestionTool | Task | `AskFollowupQuestionTool.ts` | 4KB |
| NewTaskTool | Task | `NewTaskTool.ts` | - |
| UpdateTodoListTool | Task | `UpdateTodoListTool.ts` | 7KB |
| GenerateImageTool | Generation | `GenerateImageTool.ts` | 10KB |
| FetchInstructionsTool | Other | `FetchInstructionsTool.ts` | - |
| SwitchModeTool | Other | `SwitchModeTool.ts` | - |

---

## Base Infrastructure

| File | Purpose |
|------|---------|
| `BaseTool.ts` | Abstract base class for all tools (5KB) |
| `ToolRepetitionDetector.ts` | Detect tool reuse patterns |
| `validateToolUse.ts` | Validate tool usage |

---

## Helper Utilities

| File | Purpose |
|------|---------|
| `helpers/fileTokenBudget.ts` | Token budget calculation |
| `helpers/imageHelpers.ts` | Image processing |
| `helpers/toolResultFormatting.ts` | Format tool results |
| `helpers/truncateDefinitions.ts` | Truncate definitions |

---

## Kilocode-Specific Tools

| File | Purpose |
|------|---------|
| `kilocode/condenseTool.ts` | Context condensation |
| `kilocode/deleteFileTool.ts` | Delete files |
| `kilocode/editFileTool.ts` | Enhanced edit |
| `kilocode/newRuleTool.ts` | Create rules |
| `kilocode/reportBugTool.ts` | Bug reporting |

---

[← Back to Core](../../Feature-Index.md)
