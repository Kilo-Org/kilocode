import React, { useCallback } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useTooManyTools } from "@src/hooks/useTooManyTools"
import WarningRow from "./WarningRow"

/**
 * Displays a warning when the user has too many MCP tools enabled.
 * LLMs get confused when offered too many tools, which can lead to errors.
 *
 * The warning is shown when:
 * - The total number of enabled tools across all enabled MCP servers exceeds the threshold
 *
 * @example
 * <TooManyToolsWarning />
 */
export const TooManyToolsWarning: React.FC = () => {
	const { t } = useAppTranslation()
	const { isOverThreshold, title, message } = useTooManyTools()

	const handleOpenMcpSettings = useCallback(() => {
		window.postMessage({ type: "action", action: "settingsButtonClicked", values: { section: "mcp" } }, "*")
	}, [])

	// Don't show warning if under threshold
	if (!isOverThreshold) {
		return null
	}

	return (
		<WarningRow
			title={title}
			message={message}
			actionText={t("chat:tooManyTools.openMcpSettings")}
			onAction={handleOpenMcpSettings}
		/>
	)
}

export default TooManyToolsWarning
