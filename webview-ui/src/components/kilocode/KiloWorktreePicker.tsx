import { useMemo } from "react"
import { SelectDropdown, DropdownOptionType } from "@/components/ui"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import { useExtensionState } from "@/context/ExtensionStateContext"

export const KiloWorktreePicker = () => {
	const { t } = useAppTranslation()
	const { isGitRepository, currentWorktreeMode } = useExtensionState()

	const options = useMemo(
		() => [
			{
				value: "current",
				label: t("worktree:currentDirectory"),
				type: DropdownOptionType.ITEM,
			},
			{
				value: "parallel",
				label: t("worktree:parallel"),
				type: DropdownOptionType.ITEM,
			},
		],
		[t],
	)

	const onChange = (value: string) => {
		vscode.postMessage({
			type: "setWorktreeMode",
			text: value,
		})
	}

	// Only show if we're in a git repository
	if (!isGitRepository) {
		return null
	}

	return (
		<SelectDropdown
			value={currentWorktreeMode || "current"}
			disabled={false}
			title={t("worktree:selectMode")}
			options={options}
			onChange={onChange}
			contentClassName="max-h-[300px] overflow-y-auto"
			triggerClassName={cn(
				"w-full text-ellipsis overflow-hidden",
				"bg-[var(--background)] border-[var(--vscode-input-border)] hover:bg-[var(--color-vscode-list-hoverBackground)]",
			)}
			itemClassName="group"
		/>
	)
}
