import React from "react"
import { Mode, defaultModeSlug, getAllModes } from "@roo/modes"
import { ModeConfig } from "@roo-code/types"
import { SelectDropdown, DropdownOptionType } from "@/components/ui"
import type { DropdownOption } from "@/components/ui/select-dropdown" // kilocode_change
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"

interface KiloModeSelectorProps {
	value: Mode
	onChange: (value: Mode) => void
	modeShortcutText: string
	customModes?: ModeConfig[]
	disabled?: boolean
	title?: string
	triggerClassName?: string
	initiallyOpen?: boolean
}

export const KiloModeSelector = ({
	value,
	onChange,
	modeShortcutText,
	customModes,
	disabled = false,
	title,
	triggerClassName,
	initiallyOpen,
}: KiloModeSelectorProps) => {
	const { t } = useAppTranslation()
	const allModes = React.useMemo(() => getAllModes(customModes), [customModes])

	// Group modes by source
	const { organizationModes, otherModes } = React.useMemo(() => {
		const orgModes = allModes.filter((mode) => mode.source === "organization")
		const other = allModes.filter((mode) => mode.source !== "organization")
		return { organizationModes: orgModes, otherModes: other }
	}, [allModes])

	const handleChange = React.useCallback(
		(selectedValue: string) => {
			const newMode = selectedValue as Mode
			onChange(newMode)
			vscode.postMessage({ type: "mode", text: selectedValue })
		},
		[onChange],
	)

	// Build options with organization modes grouped separately
	const options = React.useMemo(() => {
		const opts: DropdownOption[] = [
			{
				value: "shortcut",
				label: modeShortcutText,
				disabled: true,
				type: DropdownOptionType.SHORTCUT,
			},
		]

		// Add organization modes section if any exist
		if (organizationModes.length > 0) {
			// Add header as a disabled item
			opts.push({
				value: "org-header",
				label: t("chat:modeSelector.organizationModes"),
				disabled: true,
				type: DropdownOptionType.SHORTCUT,
			})
			opts.push(
				...organizationModes.map((mode) => ({
					value: mode.slug,
					label: mode.name,
					codicon: mode.iconName || "codicon-organization",
					description: mode.description,
					type: DropdownOptionType.ITEM,
				})),
			)
			opts.push({
				value: "sep-org",
				label: t("chat:separator"),
				type: DropdownOptionType.SEPARATOR,
			})
		}

		// Add other modes
		opts.push(
			...otherModes.map((mode) => ({
				value: mode.slug,
				label: mode.name,
				codicon: mode.iconName,
				description: mode.description,
				type: DropdownOptionType.ITEM,
			})),
		)

		opts.push(
			{
				value: "sep-1",
				label: t("chat:separator"),
				type: DropdownOptionType.SEPARATOR,
			},
			{
				value: "promptsButtonClicked",
				label: t("chat:edit"),
				type: DropdownOptionType.ACTION,
			},
		)

		return opts
	}, [organizationModes, otherModes, modeShortcutText, t])

	return (
		<SelectDropdown
			value={allModes.find((m) => m.slug === value)?.slug ?? defaultModeSlug}
			title={title || t("chat:selectMode")}
			disabled={disabled}
			initiallyOpen={initiallyOpen}
			options={options}
			onChange={handleChange}
			shortcutText={modeShortcutText}
			triggerClassName={cn(
				"w-full bg-[var(--background)] border-[var(--vscode-input-border)] hover:bg-[var(--color-vscode-list-hoverBackground)]",
				triggerClassName,
			)}
		/>
	)
}

export default KiloModeSelector
