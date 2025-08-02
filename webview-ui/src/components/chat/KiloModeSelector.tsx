import React from "react"
import { Mode, defaultModeSlug, getAllModes } from "@roo/modes"
import { ModeConfig } from "@roo-code/types"
import { SelectDropdown, DropdownOptionType } from "@/components/ui"
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

	const handleChange = React.useCallback(
		(selectedValue: string) => {
			const newMode = selectedValue as Mode
			onChange(newMode)
			vscode.postMessage({ type: "mode", text: selectedValue })
		},
		[onChange],
	)

	return (
		<SelectDropdown
			value={allModes.find((m) => m.slug === value)?.slug ?? defaultModeSlug}
			title={title || t("chat:selectMode")}
			disabled={disabled}
			initiallyOpen={initiallyOpen}
			options={[
				{
					value: "shortcut",
					label: modeShortcutText,
					disabled: true,
					type: DropdownOptionType.SHORTCUT,
				},
				...allModes.map((mode) => ({
					value: mode.slug,
					label: mode.name,
					codicon: mode.iconName,
					description: mode.description, // kilocode_change
					type: DropdownOptionType.ITEM,
				})),
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
			]}
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
