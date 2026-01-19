import React, { useMemo } from "react"
import { useAtomValue } from "jotai"
import { availableModesAtom, effectiveModeSlugAtom } from "../state/atoms/modes"
import { sessionsMapAtom } from "../state/atoms/sessions"
import { SelectDropdown, type DropdownOption, DropdownOptionType } from "../../../components/ui/select-dropdown"
import { vscode } from "../utils/vscode"

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
	const availableModes = useAtomValue(availableModesAtom)
	const effectiveModeSlug = useAtomValue(effectiveModeSlugAtom)
	const sessionsMap = useAtomValue(sessionsMapAtom)

	// Get the current mode from the session
	const session = sessionsMap[sessionId]
	const sessionMode = session?.mode

	// Convert modes to SelectDropdown options (without icons for now)
	const modeOptions: DropdownOption[] = useMemo(() => {
		if (!availableModes || availableModes.length === 0) return []

		const opts: DropdownOption[] = []

		// Group organization modes separately if any exist
		const organizationModes = availableModes.filter((mode) => mode.source === "organization")
		const otherModes = availableModes.filter((mode) => mode.source !== "organization")

		// Add organization modes section if any exist
		if (organizationModes.length > 0) {
			opts.push({
				value: "org-header",
				label: "Organization Modes",
				disabled: true,
				type: DropdownOptionType.SHORTCUT,
			})
			opts.push(
				...organizationModes.map((mode) => ({
					value: mode.slug,
					label: mode.name,
					description: mode.description,
					type: DropdownOptionType.ITEM,
				})),
			)
			opts.push({
				value: "sep-org",
				label: "separator",
				type: DropdownOptionType.SEPARATOR,
			})
		}

		// Add other modes
		opts.push(
			...otherModes.map((mode) => ({
				value: mode.slug,
				label: mode.name,
				description: mode.description,
				type: DropdownOptionType.ITEM,
			})),
		)

		return opts
	}, [availableModes])

	// Check if modes are available
	const hasModes = availableModes && availableModes.length > 0

	// Get the effective mode value (use session mode or fall back to effectiveModeSlug)
	const effectiveMode = sessionMode || effectiveModeSlug || ""

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
				title="Select Mode"
				triggerClassName="am-session-mode-trigger"
				contentClassName="am-session-mode-content"
				align="end"
			/>
		</div>
	)
}
