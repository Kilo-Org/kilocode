import React, { useState, useCallback } from "react"

import { useAppTranslation } from "@/i18n/TranslationContext"
import {
	Button,
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
} from "@/components/ui"
import { vscode } from "@/utils/vscode"

interface CreateSlashCommandDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onCommandCreated: () => void
	hasWorkspace: boolean
}

/**
 * Validate command name:
 * - Required
 * - Must be alphanumeric with hyphens/underscores only
 * - Max 64 characters
 */
const validateCommandName = (name: string): string | null => {
	if (!name.trim()) return "settings:slashCommands.validation.nameRequired"
	if (name.length > 64) return "settings:slashCommands.validation.nameTooLong"
	// Allow alphanumeric, hyphens, underscores
	if (!/^[a-zA-Z0-9_-]+$/.test(name)) return "settings:slashCommands.validation.nameInvalid"
	return null
}

export const CreateSlashCommandDialog: React.FC<CreateSlashCommandDialogProps> = ({
	open,
	onOpenChange,
	onCommandCreated,
	hasWorkspace,
}) => {
	const { t } = useAppTranslation()

	const [name, setName] = useState("")
	const [source, setSource] = useState<"global" | "project">(hasWorkspace ? "project" : "global")
	const [nameError, setNameError] = useState<string | null>(null)

	const resetForm = useCallback(() => {
		setName("")
		setSource(hasWorkspace ? "project" : "global")
		setNameError(null)
	}, [hasWorkspace])

	const handleClose = useCallback(() => {
		resetForm()
		onOpenChange(false)
	}, [resetForm, onOpenChange])

	const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		// Allow alphanumeric, hyphens, underscores - convert to lowercase for consistency
		const value = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "")
		setName(value)
		setNameError(null)
	}, [])

	const handleCreate = useCallback(() => {
		// Validate name
		const nameValidationError = validateCommandName(name)
		if (nameValidationError) {
			setNameError(nameValidationError)
			return
		}

		// Append .md if not already present
		const fileName = name.trim().endsWith(".md") ? name.trim() : `${name.trim()}.md`

		// Send message to create command
		vscode.postMessage({
			type: "createCommand",
			text: fileName,
			values: { source },
		})

		// Close dialog and notify parent
		handleClose()
		onCommandCreated()
	}, [name, source, handleClose, onCommandCreated])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t("settings:slashCommands.createDialog.title")}</DialogTitle>
					<DialogDescription></DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					{/* Name Input */}
					<div className="flex flex-col gap-1">
						<label htmlFor="command-name" className="text-sm font-medium text-vscode-foreground">
							{t("settings:slashCommands.createDialog.nameLabel")}
						</label>
						<Input
							id="command-name"
							type="text"
							value={name}
							onChange={handleNameChange}
							placeholder={t("settings:slashCommands.createDialog.namePlaceholder")}
							maxLength={64}
							className="w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-vscode-focusBorder"
						/>
						<span className="text-xs text-vscode-descriptionForeground">
							{t("settings:slashCommands.createDialog.nameHint")}
						</span>
						{nameError && <span className="text-xs text-vscode-errorForeground">{t(nameError)}</span>}
					</div>

					{/* Source Selection */}
					<div className="flex flex-col gap-1">
						<label className="text-sm font-medium text-vscode-foreground">
							{t("settings:slashCommands.createDialog.sourceLabel")}
						</label>
						<Select value={source} onValueChange={(value) => setSource(value as "global" | "project")}>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="global">{t("settings:slashCommands.source.global")}</SelectItem>
								{hasWorkspace && (
									<SelectItem value="project">
										{t("settings:slashCommands.source.project")}
									</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>
				</div>

				<DialogFooter>
					<Button variant="secondary" onClick={handleClose}>
						{t("settings:slashCommands.createDialog.cancel")}
					</Button>
					<Button variant="primary" onClick={handleCreate} disabled={!name}>
						{t("settings:slashCommands.createDialog.create")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
