import React, { useMemo } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { CaretDownIcon } from "@radix-ui/react-icons"
import {
	availableModesAtom,
	effectiveModeSlugAtom,
	setSelectedModeSlugAtom,
} from "../state/atoms/modes"
import { SelectDropdown, type DropdownOption, DropdownOptionType } from "../../../components/ui/select-dropdown"

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
				label: t("sessionDetail.organizationModes", "Organization Modes"),
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
	}, [availableModes, t])

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
