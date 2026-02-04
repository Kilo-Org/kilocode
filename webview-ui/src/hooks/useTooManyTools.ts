import { useMemo } from "react"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { MAX_MCP_TOOLS_THRESHOLD, countEnabledMcpTools } from "@roo-code/types"

export interface TooManyToolsInfo {
	/** Number of enabled and connected MCP servers */
	enabledServerCount: number
	/** Total number of enabled tools across all enabled servers */
	enabledToolCount: number
	/** Whether the tool count exceeds the threshold */
	isOverThreshold: boolean
	/** The maximum recommended threshold */
	threshold: number
	/** Localized title string */
	title: string
	/** Localized message string */
	message: string
}

/**
 * Hook that calculates tool counts and provides localized warning messages.
 * Used by TooManyToolsWarning components in both chat and MCP settings views.
 *
 * @returns Tool count information and localized messages
 *
 * @example
 * const { isOverThreshold, title, message } = useTooManyTools()
 * if (isOverThreshold) {
 *   // Show warning
 * }
 */
export function useTooManyTools(): TooManyToolsInfo {
	const { t } = useAppTranslation()
	const { mcpServers } = useExtensionState()

	const { enabledServerCount, enabledToolCount } = useMemo(() => countEnabledMcpTools(mcpServers), [mcpServers])

	const isOverThreshold = enabledToolCount > MAX_MCP_TOOLS_THRESHOLD

	const toolsPart = t("chat:tooManyTools.toolsPart", { count: enabledToolCount })
	const serversPart = t("chat:tooManyTools.serversPart", { count: enabledServerCount })
	const message = t("chat:tooManyTools.messageTemplate", {
		tools: toolsPart,
		servers: serversPart,
		threshold: MAX_MCP_TOOLS_THRESHOLD,
	})

	return {
		enabledServerCount,
		enabledToolCount,
		isOverThreshold,
		threshold: MAX_MCP_TOOLS_THRESHOLD,
		title: t("chat:tooManyTools.title"),
		message,
	}
}
