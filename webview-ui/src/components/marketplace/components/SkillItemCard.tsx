// kilocode_change new file

import React, { useState, useEffect } from "react"
import { SkillMarketplaceItem } from "@roo-code/types"
import { vscode } from "@/utils/vscode"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Button } from "@/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui"
import { StandardTooltip } from "@/components/ui"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface ItemInstalledMetadata {
	type: string
}

interface SkillItemCardProps {
	skill: SkillMarketplaceItem
	installed: {
		project: ItemInstalledMetadata | undefined
		global: ItemInstalledMetadata | undefined
	}
}

export const SkillItemCard: React.FC<SkillItemCardProps> = ({ skill, installed }) => {
	const { t } = useAppTranslation()
	const { cwd } = useExtensionState()
	const hasWorkspace = !!cwd
	const [isModalOpen, setIsModalOpen] = useState(false)
	const [scope, setScope] = useState<"project" | "global">(hasWorkspace ? "project" : "global")
	const [isInstalling, setIsInstalling] = useState(false)
	const [installationComplete, setInstallationComplete] = useState(false)
	const [validationError, setValidationError] = useState<string | null>(null)
	const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
	const [removeTarget, setRemoveTarget] = useState<"project" | "global">("project")
	const [removeError, setRemoveError] = useState<string | null>(null)

	// Determine installation status
	const isInstalledGlobally = !!installed.global
	const isInstalledInProject = !!installed.project
	const isInstalled = isInstalledGlobally || isInstalledInProject

	const handleViewOnGitHub = () => {
		vscode.postMessage({ type: "openExternal", url: skill.githubUrl })
	}

	const handleOpenModal = () => {
		setIsModalOpen(true)
		setScope(hasWorkspace ? "project" : "global")
		setInstallationComplete(false)
		setValidationError(null)
	}

	const handleCloseModal = () => {
		setIsModalOpen(false)
		setIsInstalling(false)
		setInstallationComplete(false)
		setValidationError(null)
	}

	const handleInstall = () => {
		setIsInstalling(true)
		setValidationError(null)
		vscode.postMessage({
			type: "installMarketplaceItem",
			mpItem: skill,
			mpInstallOptions: { target: scope },
		})
	}

	// Listen for installation and removal result messages
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "marketplaceInstallResult" && message.slug === skill.id) {
				setIsInstalling(false)
				if (message.success) {
					setInstallationComplete(true)
					setValidationError(null)
					// Request fresh marketplace data to update installed status
					vscode.postMessage({
						type: "fetchMarketplaceData",
					})
				} else {
					setValidationError(message.error || t("marketplace:install.failed"))
					setInstallationComplete(false)
				}
			}
			if (message.type === "marketplaceRemoveResult" && message.slug === skill.id) {
				if (message.success) {
					// Removal succeeded - refresh marketplace data
					vscode.postMessage({
						type: "fetchMarketplaceData",
					})
				} else {
					// Removal failed - show error message to user
					setRemoveError(message.error || t("marketplace:items.unknownError"))
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [skill.id, t])

	const { displayName, displayCategory } = skill

	return (
		<>
			<div className="border border-vscode-panel-border rounded-sm p-3 bg-vscode-editor-background">
				<div className="flex gap-2 items-start justify-between">
					<div className="flex gap-2 items-start">
						<div>
							<h3 className="text-lg font-semibold text-vscode-foreground mt-0 mb-1 leading-none">
								<Button
									variant="link"
									className="p-0 h-auto text-lg font-semibold text-vscode-foreground hover:underline"
									onClick={handleViewOnGitHub}>
									{displayName}
								</Button>
							</h3>
						</div>
					</div>
					<div className="flex items-center gap-1">
						{isInstalled ? (
							/* Single Remove button when installed */
							<StandardTooltip
								content={
									isInstalledInProject
										? t("marketplace:items.card.removeProjectTooltip")
										: t("marketplace:items.card.removeGlobalTooltip")
								}>
								<Button
									size="sm"
									variant="secondary"
									className="text-xs h-5 py-0 px-2"
									onClick={() => {
										// Determine which installation to remove (prefer project over global)
										const target = isInstalledInProject ? "project" : "global"
										setRemoveTarget(target)
										setShowRemoveConfirm(true)
									}}>
									{t("marketplace:items.card.remove")}
								</Button>
							</StandardTooltip>
						) : (
							/* Single Install button when not installed */
							<Button
								size="sm"
								variant="primary"
								className="text-xs h-5 py-0 px-2"
								onClick={handleOpenModal}>
								{t("marketplace:skills.install")}
							</Button>
						)}

						{/* Error message display */}
						{removeError && (
							<div className="text-vscode-errorForeground text-sm mt-2">
								{t("marketplace:items.removeFailed", { error: removeError })}
							</div>
						)}
					</div>
				</div>

				<p className="my-2 text-vscode-foreground">{skill.description}</p>

				{/* Installation status badges and category */}
				<div className="relative flex flex-wrap gap-1 my-2">
					{/* Installation status badge */}
					{isInstalled && (
						<span className="text-xs px-2 py-0.5 rounded-sm h-5 flex items-center bg-green-600/20 text-green-400 border border-green-600/30 shrink-0">
							{t("marketplace:items.card.installed")}
						</span>
					)}

					{/* Category badge */}
					<span className="text-xs px-2 py-0.5 rounded-sm h-5 flex items-center bg-vscode-badge-background text-vscode-badge-foreground">
						{displayCategory}
					</span>
				</div>
			</div>

			{/* Install Modal */}
			<Dialog open={isModalOpen} onOpenChange={handleCloseModal}>
				<DialogContent className="sm:max-w-[500px]">
					<DialogHeader>
						<DialogTitle>
							{installationComplete
								? t("marketplace:install.successTitle", { name: displayName })
								: t("marketplace:skills.installTitle", { name: displayName })}
						</DialogTitle>
						<DialogDescription>
							{installationComplete ? t("marketplace:install.successDescription") : null}
						</DialogDescription>
					</DialogHeader>

					{installationComplete ? (
						<div className="space-y-4 py-2">
							<div className="text-center space-y-4">
								<div className="text-green-500 text-lg">✓ {t("marketplace:install.installed")}</div>
							</div>
						</div>
					) : (
						<div className="space-y-4 py-2">
							{/* Installation Scope */}
							<div className="space-y-2">
								<div className="text-base font-semibold">{t("marketplace:install.scope")}</div>
								<div className="space-y-2">
									<label className="flex items-center space-x-2">
										<input
											type="radio"
											name="scope"
											value="project"
											checked={scope === "project"}
											onChange={() => setScope("project")}
											disabled={!hasWorkspace}
											className="rounded-full"
										/>
										<span className={!hasWorkspace ? "opacity-50" : ""}>
											{t("marketplace:install.project")}
										</span>
									</label>
									<label className="flex items-center space-x-2">
										<input
											type="radio"
											name="scope"
											value="global"
											checked={scope === "global"}
											onChange={() => setScope("global")}
											className="rounded-full"
										/>
										<span>{t("marketplace:install.global")}</span>
									</label>
								</div>
							</div>

							{/* Validation Error */}
							{validationError && (
								<div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded p-2">
									{validationError}
								</div>
							)}
						</div>
					)}

					<DialogFooter>
						{installationComplete ? (
							<Button variant="outline" onClick={handleCloseModal}>
								{t("marketplace:install.done")}
							</Button>
						) : (
							<>
								<Button variant="outline" onClick={handleCloseModal}>
									{t("common:answers.cancel")}
								</Button>
								<Button onClick={handleInstall} disabled={isInstalling}>
									{isInstalling
										? t("marketplace:skills.installing")
										: t("marketplace:install.button")}
								</Button>
							</>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Remove Confirmation Dialog */}
			<AlertDialog open={showRemoveConfirm} onOpenChange={setShowRemoveConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("marketplace:removeConfirm.skill.title")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("marketplace:removeConfirm.skill.message", { skillName: displayName })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("marketplace:removeConfirm.cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								// Clear any previous error
								setRemoveError(null)

								vscode.postMessage({
									type: "removeInstalledMarketplaceItem",
									mpItem: skill,
									mpInstallOptions: { target: removeTarget },
								})

								setShowRemoveConfirm(false)
							}}>
							{t("marketplace:removeConfirm.confirm")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
