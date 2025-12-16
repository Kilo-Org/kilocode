import { useEffect, useCallback } from "react"
import { useAtomValue } from "jotai"
import { useTranslation } from "react-i18next"
import { GitBranch, Check } from "lucide-react"
import { branchesAtom, currentBranchAtom } from "../state/atoms/branches"
import {
	Command,
	CommandInput,
	CommandList,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandSeparator,
} from "@/components/ui/command"

interface BranchPickerProps {
	selectedBranch: string | null
	onSelect: (branch: string) => void
	onClose: () => void
}

/**
 * Branch picker component using cmdk for keyboard-navigable searchable list
 * with "Your branches" (current) and "Other branches" sections
 */
export function BranchPicker({ selectedBranch, onSelect, onClose }: BranchPickerProps) {
	const { t } = useTranslation("agentManager")
	const branches = useAtomValue(branchesAtom)
	const currentBranch = useAtomValue(currentBranchAtom)

	const yourBranches = currentBranch && branches.includes(currentBranch) ? [currentBranch] : []
	const otherBranches = branches.filter((b) => b !== currentBranch)

	const handleSelect = useCallback(
		(branch: string) => {
			onSelect(branch)
			onClose()
		},
		[onSelect, onClose],
	)

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose()
			}
		}
		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [onClose])

	const handleBackdropClick = (e: React.MouseEvent) => {
		if (e.target === e.currentTarget) {
			onClose()
		}
	}

	if (branches.length === 0) {
		return (
			<div
				className="fixed inset-0 bg-black/50 flex items-start justify-center pt-20 z-50"
				onClick={handleBackdropClick}>
				<div className="bg-vscode-editor-background border border-vscode-editorWidget-border rounded-md shadow-lg w-96 p-4 text-center text-vscode-descriptionForeground">
					<GitBranch size={24} className="mx-auto mb-2 opacity-50" />
					{t("sessionDetail.noBranches")}
				</div>
			</div>
		)
	}

	return (
		<div
			className="fixed inset-0 bg-black/50 flex items-start justify-center pt-20 z-50"
			onClick={handleBackdropClick}>
			<Command className="bg-vscode-editor-background border border-vscode-editorWidget-border rounded-md shadow-lg w-96 max-h-96 flex flex-col overflow-hidden">
				<CommandInput placeholder={t("sessionDetail.searchBranches")} autoFocus />
				<CommandList>
					<CommandEmpty>{t("sessionDetail.noMatchingBranches")}</CommandEmpty>

					{yourBranches.length > 0 && (
						<CommandGroup heading={t("sessionDetail.yourBranches")}>
							{yourBranches.map((branch) => (
								<CommandItem key={branch} value={branch} onSelect={() => handleSelect(branch)}>
									<GitBranch size={12} className="flex-shrink-0" />
									<span className="truncate flex-1">{branch}</span>
									{selectedBranch === branch && <Check size={12} className="ml-auto" />}
								</CommandItem>
							))}
						</CommandGroup>
					)}

					{yourBranches.length > 0 && otherBranches.length > 0 && <CommandSeparator />}

					{otherBranches.length > 0 && (
						<CommandGroup heading={t("sessionDetail.otherBranches")}>
							{otherBranches.map((branch) => (
								<CommandItem key={branch} value={branch} onSelect={() => handleSelect(branch)}>
									<GitBranch size={12} className="flex-shrink-0" />
									<span className="truncate flex-1">{branch}</span>
									{selectedBranch === branch && <Check size={12} className="ml-auto" />}
								</CommandItem>
							))}
						</CommandGroup>
					)}
				</CommandList>
			</Command>
		</div>
	)
}
