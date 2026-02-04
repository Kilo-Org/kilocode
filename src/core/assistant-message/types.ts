import type { TextContent, ToolUse, McpToolUse } from "../../shared/tools"

export type AssistantMessageContent = TextContent | ToolUse | McpToolUse
