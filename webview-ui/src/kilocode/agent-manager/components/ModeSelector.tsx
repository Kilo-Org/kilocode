import React from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { CaretDownIcon } from "@radix-ui/react-icons"
import { availableModesAtom, effectiveModeSlugAtom, setSelectedModeSlugAtom } from "../state/atoms/modes"
import { SelectDropdown } from "../../../components/ui/select-dropdown"
import { useModeOptions } from "../hooks/useModeOptions"

interface ModeSelectorProps {
	disabled?: boolean
}

/**
 * Mode selector dropdown for the Agent Manager.
 * Allows users to select the mode (e.g., "code", "architect", "debug") for new sessions.
 * Uses the same styling as KiloModeSelector from the main sidebar.
 */
export function ModeSelector({ disabled = false }: ModeSelectorProps) {
	const { t } = useTranslation("agentManager")
	const availableModes = useAtomValue(availableModesAtom)
	const effectiveModeSlug = useAtomValue(effectiveModeSlugAtom)
	const setSelectedModeSlug = useSetAtom(setSelectedModeSlugAtom)

	// Use shared hook for building mode options
	const modeOptions = useModeOptions({
		organizationModesLabel: t("sessionDetail.organizationModes", "Organization Modes"),
	})

	const handleModeChange = (newMode: string) => {
		if (newMode === effectiveModeSlug) return
		setSelectedModeSlug(newMode)
	}

	// Don't render if no modes available
	if (availableModes.length === 0) {
		return null
	}

	return (
		<div className="am-mode-selector">
			<SelectDropdown
				value={effectiveModeSlug}
				options={modeOptions}
				onChange={handleModeChange}
				disabled={disabled}
				title={t("sessionDetail.selectMode", "Select Mode")}
				triggerClassName="am-mode-selector-trigger"
				contentClassName="am-mode-selector-content"
				align="end"
				triggerIcon={CaretDownIcon}
			/>
		</div>
	)
}
