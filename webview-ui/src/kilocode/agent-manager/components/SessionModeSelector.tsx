import React, { useMemo } from "react"
import { useAtomValue } from "jotai"
import { useTranslation } from "react-i18next"
import { DEFAULT_MODE_SLUG } from "@roo-code/types"
import { availableModesAtom } from "../state/atoms/modes"
import { sessionsMapAtom } from "../state/atoms/sessions"
import { SelectDropdown } from "../../../components/ui/select-dropdown"
import { vscode } from "../utils/vscode"
import { useModeOptions } from "../hooks/useModeOptions"

interface SessionModeSelectorProps {
	sessionId: string
	disabled?: boolean
}

/**
 * Mode selector for running sessions.
 * Allows changing the mode during a session by sending a setMode message to the CLI.
 * Compact design to fit in the toolbar without overflow.
 */
export const SessionModeSelector: React.FC<SessionModeSelectorProps> = ({ sessionId, disabled = false }) => {
	const { t } = useTranslation("agentManager")
	const availableModes = useAtomValue(availableModesAtom)
	const sessionsMap = useAtomValue(sessionsMapAtom)

	// Get the current mode from the session (each session stores its own mode)
	const session = sessionsMap[sessionId]
	const sessionMode = session?.mode

	// Use shared hook for building mode options
	const modeOptions = useModeOptions()

	// Check if modes are available
	const hasModes = availableModes && availableModes.length > 0

	// Get the effective mode value (use session mode or fall back to default)
	// Note: We don't use the global effectiveModeSlugAtom here because each session
	// should have its own mode stored independently
	const effectiveMode = sessionMode || DEFAULT_MODE_SLUG

	// Get the current mode name for display (truncated)
	const currentModeName = useMemo(() => {
		const mode = availableModes.find((m) => m.slug === effectiveMode)
		return mode?.name || effectiveMode
	}, [availableModes, effectiveMode])

	const handleModeChange = (newMode: string) => {
		if (newMode === effectiveMode) return

		// Send setMode message to extension
		vscode.postMessage({
			type: "agentManager.setMode",
			sessionId,
			mode: newMode,
		})
	}

	if (!hasModes) {
		return null
	}

	return (
		<div className="am-session-mode-selector" title={`Mode: ${currentModeName}`}>
			<SelectDropdown
				value={effectiveMode}
				options={modeOptions}
				onChange={handleModeChange}
				disabled={disabled}
				title={t("sessionDetail.selectMode", "Select Mode")}
				triggerClassName="am-session-mode-trigger"
				contentClassName="am-session-mode-content"
				align="end"
			/>
		</div>
	)
}
