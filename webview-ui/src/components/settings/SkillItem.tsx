import React, { useCallback, useMemo } from "react"
import { Edit, Trash2 } from "lucide-react"

import type { SkillMetadata } from "@roo-code/types"

import { getAllModes } from "@roo/modes"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { Button, StandardTooltip, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui"
import { vscode } from "@/utils/vscode"

// Sentinel value for "Any mode" since Radix Select doesn't allow empty string values
const MODE_ANY = "__any__"

interface SkillItemProps {
	skill: SkillMetadata
	onEdit: () => void
	onDelete: () => void
}

export const SkillItem: React.FC<SkillItemProps> = ({ skill, onEdit, onDelete }) => {
	const { t } = useAppTranslation()
	const { customModes } = useExtensionState()

	// Get available modes for the dropdown (built-in + custom modes)
	const availableModes = useMemo(() => {
		return getAllModes(customModes).map((m) => ({ slug: m.slug, name: m.name }))
	}, [customModes])

	// Current mode value for the select (using sentinel for "Any mode")
	const currentModeValue = skill.mode || MODE_ANY

	// Handle mode change
	const handleModeChange = useCallback(
		(newModeValue: string) => {
			const newMode = newModeValue === MODE_ANY ? undefined : newModeValue

			// Don't do anything if mode hasn't changed
			if (newMode === skill.mode) {
				return
			}

			// Send message to move skill to new mode
			vscode.postMessage({
				type: "moveSkill",
				skillName: skill.name,
				source: skill.source,
				skillMode: skill.mode,
				newSkillMode: newMode,
			})
		},
		[skill.name, skill.source, skill.mode],
	)

	// Built-in skills cannot change mode
	const isBuiltIn = skill.source === "built-in"

	return (
		<div className="px-4 py-2 text-sm flex items-center group hover:bg-vscode-list-hoverBackground">
			{/* Skill name and description */}
			<div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
				<div className="flex items-center gap-2">
					<span className="truncate text-vscode-foreground">{skill.name}</span>
				</div>
				{skill.description && (
					<div className="text-xs text-vscode-descriptionForeground truncate mt-0.5">{skill.description}</div>
				)}
			</div>

			{/* Mode dropdown */}
			<div className="ml-2 shrink-0">
				{isBuiltIn ? (
					<span className="px-1.5 py-0.5 text-xs rounded bg-vscode-badge-background text-vscode-badge-foreground">
						{skill.mode || t("settings:skills.modeAny")}
					</span>
				) : (
					<StandardTooltip content={t("settings:skills.changeMode")}>
						<Select value={currentModeValue} onValueChange={handleModeChange}>
							<SelectTrigger className="h-6 w-auto min-w-[80px] max-w-[120px] text-xs px-2 py-0.5 border-none bg-vscode-badge-background text-vscode-badge-foreground hover:bg-vscode-button-hoverBackground">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={MODE_ANY}>{t("settings:skills.modeAny")}</SelectItem>
								{availableModes.map((m) => (
									<SelectItem key={m.slug} value={m.slug}>
										{m.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</StandardTooltip>
				)}
			</div>

			{/* Action buttons */}
			<div className="flex items-center gap-2 ml-2">
				<StandardTooltip content={t("settings:skills.editSkill")}>
					<Button
						variant="ghost"
						size="icon"
						tabIndex={-1}
						onClick={onEdit}
						className="size-6 flex items-center justify-center opacity-60 hover:opacity-100">
						<Edit className="w-4 h-4" />
					</Button>
				</StandardTooltip>

				{!isBuiltIn && (
					<StandardTooltip content={t("settings:skills.deleteSkill")}>
						<Button
							variant="ghost"
							size="icon"
							tabIndex={-1}
							onClick={onDelete}
							className="size-6 flex items-center justify-center opacity-60 hover:opacity-100 hover:text-red-400">
							<Trash2 className="w-4 h-4" />
						</Button>
					</StandardTooltip>
				)}
			</div>
		</div>
	)
}
