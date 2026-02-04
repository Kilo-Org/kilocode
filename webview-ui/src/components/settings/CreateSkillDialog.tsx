import React, { useState, useCallback, useMemo } from "react"
import { validateSkillName as validateSkillNameShared, SkillNameValidationError } from "@roo-code/types"

import { getAllModes } from "@roo/modes"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import {
	Button,
	Checkbox,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Textarea,
} from "@/components/ui"
import { vscode } from "@/utils/vscode"

interface CreateSkillDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onSkillCreated: () => void
	hasWorkspace: boolean
}

/**
 * Map skill name validation error codes to translation keys.
 */
const getSkillNameErrorTranslationKey = (error: SkillNameValidationError): string => {
	switch (error) {
		case SkillNameValidationError.Empty:
			return "settings:skills.validation.nameRequired"
		case SkillNameValidationError.TooLong:
			return "settings:skills.validation.nameTooLong"
		case SkillNameValidationError.InvalidFormat:
			return "settings:skills.validation.nameInvalid"
	}
}

/**
 * Validate skill name using shared validation from @roo-code/types.
 * Returns a translation key for the error, or null if valid.
 */
const validateSkillName = (name: string): string | null => {
	const result = validateSkillNameShared(name)
	if (!result.valid) {
		return getSkillNameErrorTranslationKey(result.error!)
	}
	return null
}

/**
 * Validate description according to agentskills.io spec:
 * - Required field
 * - 1-1024 characters
 */
const validateDescription = (description: string): string | null => {
	if (!description) return "settings:skills.validation.descriptionRequired"
	if (description.length > 1024) return "settings:skills.validation.descriptionTooLong"
	return null
}

export const CreateSkillDialog: React.FC<CreateSkillDialogProps> = ({
	open,
	onOpenChange,
	onSkillCreated,
	hasWorkspace,
}) => {
	const { t } = useAppTranslation()
	const { customModes } = useExtensionState()

	const [name, setName] = useState("")
	const [description, setDescription] = useState("")
	const [source, setSource] = useState<"global" | "project">(hasWorkspace ? "project" : "global")
	const [nameError, setNameError] = useState<string | null>(null)
	const [descriptionError, setDescriptionError] = useState<string | null>(null)

	// Multi-mode selection state (same pattern as SkillsSettings mode dialog)
	const [selectedModes, setSelectedModes] = useState<string[]>([])
	const [isAnyMode, setIsAnyMode] = useState(true)

	// Get available modes for the checkboxes (built-in + custom modes)
	const availableModes = useMemo(() => {
		return getAllModes(customModes).map((m) => ({ slug: m.slug, name: m.name }))
	}, [customModes])

	const resetForm = useCallback(() => {
		setName("")
		setDescription("")
		setSource(hasWorkspace ? "project" : "global")
		setSelectedModes([])
		setIsAnyMode(true)
		setNameError(null)
		setDescriptionError(null)
	}, [hasWorkspace])

	const handleClose = useCallback(() => {
		resetForm()
		onOpenChange(false)
	}, [resetForm, onOpenChange])

	const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
		setName(value)
		setNameError(null)
	}, [])

	const handleDescriptionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setDescription(e.target.value)
		setDescriptionError(null)
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

	const handleCreate = useCallback(() => {
		// Validate fields
		const nameValidationError = validateSkillName(name)
		const descValidationError = validateDescription(description)

		if (nameValidationError) {
			setNameError(nameValidationError)
			return
		}

		if (descValidationError) {
			setDescriptionError(descValidationError)
			return
		}

		// Send message to create skill
		// Convert to modeSlugs: undefined for "Any mode", or array of selected modes
		const modeSlugs = isAnyMode ? undefined : selectedModes.length > 0 ? selectedModes : undefined
		vscode.postMessage({
			type: "createSkill",
			skillName: name,
			source,
			skillDescription: description,
			skillModeSlugs: modeSlugs,
		})

		// Close dialog and notify parent
		handleClose()
		onSkillCreated()
	}, [name, description, source, isAnyMode, selectedModes, handleClose, onSkillCreated])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t("settings:skills.createDialog.title")}</DialogTitle>
					<DialogDescription></DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					{/* Name Input */}
					<div className="flex flex-col gap-1">
						<label htmlFor="skill-name" className="text-sm font-medium text-vscode-foreground">
							{t("settings:skills.createDialog.nameLabel")}
						</label>
						<Input
							id="skill-name"
							type="text"
							value={name}
							onChange={handleNameChange}
							placeholder={t("settings:skills.createDialog.namePlaceholder")}
							maxLength={64}
							className="w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded-xl px-3 py-2 focus:outline-none focus:border-vscode-focusBorder"
						/>
						{nameError && <span className="text-xs text-vscode-errorForeground">{t(nameError)}</span>}
					</div>

					{/* Description Input */}
					<div className="flex flex-col gap-1">
						<Textarea
							id="skill-description"
							value={description}
							onChange={handleDescriptionChange}
							placeholder={t("settings:skills.createDialog.descriptionPlaceholder")}
							maxLength={1024}
							rows={5}
						/>
						{descriptionError && (
							<span className="text-xs text-vscode-errorForeground">{t(descriptionError)}</span>
						)}
					</div>

					{/* Source Selection */}
					<div className="flex flex-col gap-1">
						<label className="text-sm font-medium text-vscode-foreground">
							{t("settings:skills.createDialog.sourceLabel")}
						</label>
						<Select value={source} onValueChange={(value) => setSource(value as "global" | "project")}>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="global">{t("settings:skills.source.global")}</SelectItem>
								{hasWorkspace && (
									<SelectItem value="project">{t("settings:skills.source.project")}</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>

					{/* Mode Selection (Optional) */}
					<div className="flex flex-col gap-1">
						<label className="text-sm font-medium text-vscode-foreground">
							{t("settings:skills.createDialog.modeLabel")}
						</label>
						<span className="text-xs text-vscode-descriptionForeground mb-1">
							{t("settings:skills.modeDialog.intro")}
						</span>

						{/* Individual mode checkboxes */}
						<div className="flex flex-col max-h-28 overflow-y-auto">
							{/* Any mode option */}
							<div className="flex items-center gap-3 p-1 rounded-lg hover:bg-vscode-list-hoverBackground">
								<Checkbox
									id="create-mode-any"
									checked={isAnyMode}
									onCheckedChange={(checked) => handleAnyModeToggle(checked === true)}
								/>
								<label htmlFor="create-mode-any" className="flex-1 cursor-pointer font-medium">
									{t("settings:skills.modeDialog.anyMode")}
								</label>
							</div>
							{availableModes.map((m) => (
								<div
									key={m.slug}
									className="flex items-center gap-3 p-1 rounded-lg hover:bg-vscode-list-hoverBackground">
									<Checkbox
										id={`create-mode-${m.slug}`}
										checked={selectedModes.includes(m.slug)}
										onCheckedChange={(checked) => handleModeToggle(m.slug, checked === true)}
									/>
									<label htmlFor={`create-mode-${m.slug}`} className="flex-1 cursor-pointer">
										{m.name}
									</label>
								</div>
							))}
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="secondary" onClick={handleClose}>
						{t("settings:skills.createDialog.cancel")}
					</Button>
					<Button variant="primary" onClick={handleCreate} disabled={!name || !description}>
						{t("settings:skills.createDialog.create")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
