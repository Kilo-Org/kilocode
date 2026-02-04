import React, { useState, useEffect, useMemo, useCallback } from "react"
import { Plus, Globe, Folder, Edit, Trash2, Settings } from "lucide-react"
import { Trans } from "react-i18next"

import type { SkillMetadata } from "@roo-code/types"

import { getAllModes } from "@roo/modes"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
	Checkbox,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	StandardTooltip,
} from "@/components/ui"
import { vscode } from "@/utils/vscode"
import { buildDocLink } from "@/utils/docLinks"

import { SectionHeader } from "./SectionHeader"
import { CreateSkillDialog } from "./CreateSkillDialog"

export const SkillsSettings: React.FC = () => {
	const { t } = useAppTranslation()
	const { cwd, skills: rawSkills, customModes } = useExtensionState()
	const skills = useMemo(() => rawSkills ?? [], [rawSkills])

	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [skillToDelete, setSkillToDelete] = useState<SkillMetadata | null>(null)
	const [createDialogOpen, setCreateDialogOpen] = useState(false)

	// Mode selection modal state
	const [modeDialogOpen, setModeDialogOpen] = useState(false)
	const [skillToEditModes, setSkillToEditModes] = useState<SkillMetadata | null>(null)
	const [selectedModes, setSelectedModes] = useState<string[]>([])
	const [isAnyMode, setIsAnyMode] = useState(true)

	// Check if we're in a workspace/project
	const hasWorkspace = Boolean(cwd)

	// Get available modes for the checkboxes (built-in + custom modes)
	const availableModes = useMemo(() => {
		return getAllModes(customModes).map((m) => ({ slug: m.slug, name: m.name }))
	}, [customModes])

	const handleRefresh = useCallback(() => {
		vscode.postMessage({ type: "requestSkills" })
	}, [])

	// Request skills when component mounts
	useEffect(() => {
		handleRefresh()
	}, [handleRefresh])

	const handleDeleteClick = useCallback((skill: SkillMetadata) => {
		setSkillToDelete(skill)
		setDeleteDialogOpen(true)
	}, [])

	const handleDeleteConfirm = useCallback(() => {
		if (skillToDelete) {
			vscode.postMessage({
				type: "deleteSkill",
				skillName: skillToDelete.name,
				source: skillToDelete.source,
				skillModeSlugs: skillToDelete.modeSlugs,
			})
			setDeleteDialogOpen(false)
			setSkillToDelete(null)
		}
	}, [skillToDelete])

	const handleDeleteCancel = useCallback(() => {
		setDeleteDialogOpen(false)
		setSkillToDelete(null)
	}, [])

	const handleEditClick = useCallback((skill: SkillMetadata) => {
		vscode.postMessage({
			type: "openSkillFile",
			skillName: skill.name,
			source: skill.source,
			skillModeSlugs: skill.modeSlugs,
		})
	}, [])

	// Open mode selection modal
	const handleOpenModeDialog = useCallback((skill: SkillMetadata) => {
		setSkillToEditModes(skill)
		// Initialize state from skill's current modeSlugs
		const hasModeSlugs = skill.modeSlugs && skill.modeSlugs.length > 0
		setIsAnyMode(!hasModeSlugs)
		setSelectedModes(hasModeSlugs ? [...skill.modeSlugs!] : [])
		setModeDialogOpen(true)
	}, [])

	// Handle "Any mode" toggle - mutually exclusive with specific modes
	const handleAnyModeToggle = useCallback((checked: boolean) => {
		if (checked) {
			setIsAnyMode(true)
			setSelectedModes([]) // Clear specific modes when "Any mode" is selected
		} else {
			setIsAnyMode(false)
		}
	}, [])

	// Handle specific mode toggle - unchecks "Any mode" when a specific mode is selected
	const handleModeToggle = useCallback((modeSlug: string, checked: boolean) => {
		if (checked) {
			setIsAnyMode(false) // Uncheck "Any mode" when selecting a specific mode
			setSelectedModes((prev) => [...prev, modeSlug])
		} else {
			setSelectedModes((prev) => {
				const newModes = prev.filter((m) => m !== modeSlug)
				// If no modes selected, default back to "Any mode"
				if (newModes.length === 0) {
					setIsAnyMode(true)
				}
				return newModes
			})
		}
	}, [])

	// Save mode changes
	const handleSaveModes = useCallback(() => {
		if (skillToEditModes) {
			const newModeSlugs = isAnyMode ? undefined : selectedModes.length > 0 ? selectedModes : undefined
			vscode.postMessage({
				type: "updateSkillModes",
				skillName: skillToEditModes.name,
				source: skillToEditModes.source,
				newSkillModeSlugs: newModeSlugs,
			})
			setModeDialogOpen(false)
			setSkillToEditModes(null)
		}
	}, [skillToEditModes, isAnyMode, selectedModes])

	const handleCloseModeDialog = useCallback(() => {
		setModeDialogOpen(false)
		setSkillToEditModes(null)
	}, [])

	// No-op callback - the backend sends updated skills list via ExtensionStateContext
	const handleSkillCreated = useCallback(() => {}, [])

	// Group skills by source
	const projectSkills = useMemo(() => skills.filter((skill) => skill.source === "project"), [skills])
	const globalSkills = useMemo(() => skills.filter((skill) => skill.source === "global"), [skills])

	// Render a single skill item
	const renderSkillItem = useCallback(
		(skill: SkillMetadata) => {
			const isBuiltIn = skill.source === "built-in"

			return (
				<div
					key={`${skill.source}-${skill.name}-${skill.modeSlugs?.join(",") || "any"}`}
					className="p-2.5 px-2 rounded-xl border border-transparent">
					<div className="flex items-start justify-between gap-2 flex-col min-[400px]:flex-row overflow-hidden">
						<div className="flex-1 min-w-0">
							{/* Skill name */}
							<div className="flex items-center gap-2 overflow-hidden">
								<span className="font-medium truncate">{skill.name}</span>
							</div>
							{/* Skill description */}
							{skill.description && (
								<div className="text-xs text-vscode-descriptionForeground mt-1 line-clamp-3">
									{skill.description}
								</div>
							)}
						</div>

						{/* Actions */}
						<div className="flex items-center gap-1 px-0 ml-0 min-[400px]:ml-0 min-[400px]:mt-4 flex-shrink-0">
							{/* Mode settings button (gear icon) - only for non-built-in skills */}
							{!isBuiltIn && (
								<StandardTooltip content={t("settings:skills.configureModes")}>
									<Button variant="ghost" size="icon" onClick={() => handleOpenModeDialog(skill)}>
										<Settings className="size-4" />
									</Button>
								</StandardTooltip>
							)}

							<StandardTooltip content={t("settings:skills.editSkill")}>
								<Button variant="ghost" size="icon" onClick={() => handleEditClick(skill)}>
									<Edit />
								</Button>
							</StandardTooltip>

							{!isBuiltIn && (
								<StandardTooltip content={t("settings:skills.deleteSkill")}>
									<Button variant="ghost" size="icon" onClick={() => handleDeleteClick(skill)}>
										<Trash2 className="text-destructive" />
									</Button>
								</StandardTooltip>
							)}
						</div>
					</div>
				</div>
			)
		},
		[t, handleOpenModeDialog, handleEditClick, handleDeleteClick],
	)

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Fixed Header */}
			<div className="flex-shrink-0">
				<SectionHeader>{t("settings:sections.skills")}</SectionHeader>
				<div className="flex flex-col gap-2 px-5 py-2">
					<p className="text-vscode-descriptionForeground text-sm m-0">
						<Trans
							i18nKey="settings:skills.description"
							components={{
								DocsLink: (
									<a
										href={buildDocLink("features/skills", "skills_settings")}
										target="_blank"
										rel="noopener noreferrer"
										className="text-vscode-textLink-foreground hover:underline">
										Docs
									</a>
								),
							}}
						/>
					</p>

					{/* Add Skill button */}
					<Button variant="secondary" className="py-1" onClick={() => setCreateDialogOpen(true)}>
						<Plus />
						{t("settings:skills.addSkill")}
					</Button>
				</div>
			</div>

			{/* Scrollable List Area */}
			<div className="flex-1 overflow-y-auto px-4 py-2 min-h-0">
				<div className="flex flex-col gap-1">
					{/* Project Skills Section - Only show if in a workspace */}
					{hasWorkspace && (
						<>
							<div className="flex items-center gap-2 px-2 py-2 mt-2 cursor-default">
								<Folder className="size-4 shrink-0" />
								<span className="font-medium text-lg">{t("settings:skills.workspaceSkills")}</span>
							</div>
							{projectSkills.length > 0 ? (
								projectSkills.map(renderSkillItem)
							) : (
								<div className="px-2 pb-4 text-sm text-vscode-descriptionForeground cursor-default">
									{t("settings:skills.noWorkspaceSkills")}
								</div>
							)}
						</>
					)}

					{/* Global Skills Section */}
					<div className="flex items-center gap-2 px-2 py-2 mt-2 cursor-default">
						<Globe className="size-4 shrink-0" />
						<span className="font-medium text-lg">{t("settings:skills.globalSkills")}</span>
					</div>
					{globalSkills.length > 0 ? (
						globalSkills.map(renderSkillItem)
					) : (
						<div className="px-2 pb-4 text-sm text-vscode-descriptionForeground cursor-default">
							{t("settings:skills.noGlobalSkills")}
						</div>
					)}
				</div>
			</div>

			{/* Fixed Footer */}
			<div className="px-6 py-1 text-sm border-t border-vscode-panel-border text-muted-foreground">
				<Trans
					i18nKey="settings:skills.footer"
					components={{
						MarketplaceLink: (
							<span
								onClick={() => {
									window.postMessage(
										{
											type: "action",
											action: "marketplaceButtonClicked",
											values: { marketplaceTab: "mode" },
										},
										"*",
									)
								}}
								className="text-vscode-textLink-foreground hover:underline cursor-pointer"
							/>
						),
					}}
				/>
			</div>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("settings:skills.deleteDialog.title")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("settings:skills.deleteDialog.description", { name: skillToDelete?.name })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={handleDeleteCancel}>
							{t("settings:skills.deleteDialog.cancel")}
						</AlertDialogCancel>
						<AlertDialogAction onClick={handleDeleteConfirm}>
							{t("settings:skills.deleteDialog.confirm")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Create Skill Dialog */}
			<CreateSkillDialog
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
				onSkillCreated={handleSkillCreated}
				hasWorkspace={hasWorkspace}
			/>

			{/* Mode Selection Dialog */}
			<Dialog open={modeDialogOpen} onOpenChange={setModeDialogOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>{t("settings:skills.modeDialog.title")}</DialogTitle>
						<DialogDescription></DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-1">
						{/* Intro text */}
						<p className="text-vscode-descriptionForeground">{t("settings:skills.modeDialog.intro")}</p>

						{/* Any mode option */}
						<div className="flex items-center gap-3 px-1 rounded-lg hover:bg-vscode-list-hoverBackground">
							<Checkbox
								id="mode-any"
								checked={isAnyMode}
								onCheckedChange={(checked) => handleAnyModeToggle(checked === true)}
							/>
							<label htmlFor="mode-any" className="flex-1 cursor-pointer font-medium">
								{t("settings:skills.modeDialog.anyMode")}
							</label>
						</div>

						{/* Separator */}
						<div className="h-px bg-vscode-widget-border" />

						{/* Individual mode checkboxes */}
						<div className="flex flex-col max-h-60 overflow-y-auto">
							{availableModes.map((mode) => (
								<div
									key={mode.slug}
									className="flex items-center gap-3 p-1 rounded-lg hover:bg-vscode-list-hoverBackground">
									<Checkbox
										id={`mode-${mode.slug}`}
										checked={selectedModes.includes(mode.slug)}
										onCheckedChange={(checked) => handleModeToggle(mode.slug, checked === true)}
									/>
									<label htmlFor={`mode-${mode.slug}`} className="flex-1 cursor-pointer">
										{mode.name}
									</label>
								</div>
							))}
						</div>
					</div>

					<DialogFooter>
						<Button variant="secondary" onClick={handleCloseModeDialog}>
							{t("settings:skills.modeDialog.cancel")}
						</Button>
						<Button onClick={handleSaveModes}>{t("settings:skills.modeDialog.save")}</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
