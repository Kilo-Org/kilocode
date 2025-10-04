import { DiffStrategy } from "../../../shared/tools"
import { McpHub } from "../../../services/mcp/McpHub"
import { Experiments } from "@roo-code/types"
import { type ClineProviderState } from "../../webview/ClineProvider" // kilocode_change

export type ToolArgs = {
	cwd: string
	supportsComputerUse: boolean
	diffStrategy?: DiffStrategy
	browserViewportSize?: string
	mcpHub?: McpHub
	toolOptions?: any
	partialReadsEnabled?: boolean
	settings?: Record<string, any>
	experiments?: Partial<Experiments>
	clineProviderState?: ClineProviderState // kilocode_change: For Grok detection
}
