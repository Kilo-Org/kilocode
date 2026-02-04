import { useState, useEffect, useCallback } from "react"

import type { Worktree, WorktreeListResponse, WorktreeIncludeStatus } from "@roo-code/types"

import { Badge, Button, StandardTooltip, ToggleSwitch } from "@/components/ui"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"

import { SectionHeader } from "../settings/SectionHeader"

import { CreateWorktreeModal } from "./CreateWorktreeModal"
import { DeleteWorktreeModal } from "./DeleteWorktreeModal"
import { Folder, GitBranch, Lock, Plus, SquareArrowOutUpRight, Trash } from "lucide-react"

export const WorktreesView = () => {
	const { t } = useAppTranslation()
	const { showWorktreesInHomeScreen, setShowWorktreesInHomeScreen } = useExtensionState()

	// State
	const [worktrees, setWorktrees] = useState<Worktree[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [isGitRepo, setIsGitRepo] = useState(true)
	const [isMultiRoot, setIsMultiRoot] = useState(false)
	const [isSubfolder, setIsSubfolder] = useState(false)
	const [gitRootPath, setGitRootPath] = useState("")

	// Worktree include status
	const [includeStatus, setIncludeStatus] = useState<WorktreeIncludeStatus | null>(null)
	const [isCreatingInclude, setIsCreatingInclude] = useState(false)

	// Modals
	const [showCreateModal, setShowCreateModal] = useState(false)
	const [deleteWorktree, setDeleteWorktree] = useState<Worktree | null>(null)

	// Fetch worktrees list
	const fetchWorktrees = useCallback(() => {
		vscode.postMessage({ type: "listWorktrees" })
	}, [])

	// Fetch worktree include status
	const fetchIncludeStatus = useCallback(() => {
		vscode.postMessage({ type: "getWorktreeIncludeStatus" })
	}, [])

	// Handle messages from extension
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			switch (message.type) {
				case "worktreeList": {
					const response: WorktreeListResponse = message
					setWorktrees(response.worktrees || [])
					setIsGitRepo(response.isGitRepo)
					setIsMultiRoot(response.isMultiRoot)
					setIsSubfolder(response.isSubfolder)
					setGitRootPath(response.gitRootPath)
					setError(response.error || null)
					setIsLoading(false)
					break
				}
				case "worktreeIncludeStatus": {
					console.log("[WorktreesView] Received worktreeIncludeStatus:", message)
					setIncludeStatus(message.worktreeIncludeStatus)
					break
				}
				case "worktreeResult": {
					console.log("[WorktreesView] Received worktreeResult:", message)
					// Refresh list and include status after any worktree operation
					fetchWorktrees()
					fetchIncludeStatus()
					setIsCreatingInclude(false)
					break
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [fetchWorktrees, fetchIncludeStatus])

	// Initial fetch and polling
	useEffect(() => {
		fetchWorktrees()
		fetchIncludeStatus()

		// Poll every 3 seconds for updates
		const interval = setInterval(fetchWorktrees, 3000)
		return () => clearInterval(interval)
	}, [fetchWorktrees, fetchIncludeStatus])

	// Handle create worktree include file
	const handleCreateWorktreeInclude = useCallback(() => {
		console.log("[WorktreesView] handleCreateWorktreeInclude called, includeStatus:", includeStatus)
		if (!includeStatus?.gitignoreContent) {
			console.log("[WorktreesView] No gitignoreContent, returning early")
			return
		}
		setIsCreatingInclude(true)
		console.log(
			"[WorktreesView] Sending createWorktreeInclude with content length:",
			includeStatus.gitignoreContent.length,
		)
		vscode.postMessage({
			type: "createWorktreeInclude",
			worktreeIncludeContent: includeStatus.gitignoreContent,
		} as const)
		// Refresh status after a short delay
		setTimeout(() => {
			fetchIncludeStatus()
			setIsCreatingInclude(false)
		}, 500)
	}, [includeStatus, fetchIncludeStatus])

	// Handle switch worktree
	const handleSwitchWorktree = useCallback((worktreePath: string, newWindow: boolean) => {
		vscode.postMessage({
			type: "switchWorktree",
			worktreePath: worktreePath,
			worktreeNewWindow: newWindow,
		})
	}, [])

	// Handle toggle show in home screen
	const handleToggleShowInHomeScreen = useCallback(() => {
		const newValue = !showWorktreesInHomeScreen
		setShowWorktreesInHomeScreen(newValue)
		vscode.postMessage({
			type: "updateSettings",
			updatedSettings: { showWorktreesInHomeScreen: newValue },
		})
	}, [showWorktreesInHomeScreen, setShowWorktreesInHomeScreen])

	// Render error states
	if (!isGitRepo) {
		return (
			<div>
				<SectionHeader>{t("worktrees:title")}</SectionHeader>
				<div className="px-5 text-sm">
					<p className="text-vscode-descriptionForeground">{t("worktrees:description")}</p>
					<p>{t("worktrees:notGitRepo")}</p>
				</div>
			</div>
		)
	}

	if (isMultiRoot) {
		return (
			<div>
				<SectionHeader>{t("worktrees:title")}</SectionHeader>
				<div className="px-5 text-sm">
					<p className="text-vscode-descriptionForeground">{t("worktrees:description")}</p>
					<p>{t("worktrees:multiRootNotSupported")}</p>
				</div>
			</div>
		)
	}

	if (isSubfolder) {
		return (
			<div>
				<SectionHeader>{t("worktrees:title")}</SectionHeader>
				<div className="px-5 text-sm">
					<p className="text-vscode-descriptionForeground">{t("worktrees:description")}</p>
					<p>{t("worktrees:subfolderNotSupported")}</p>
					<p>
						{t("worktrees:gitRoot")}:{" "}
						<code className="bg-vscode-input-background p-1 rounded-md">{gitRootPath}</code>
					</p>
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Fixed Header */}
			<div className="flex-shrink-0">
				<SectionHeader>{t("worktrees:title")}</SectionHeader>
				<div className="flex flex-col gap-2 px-5 py-2">
					<p className="text-vscode-descriptionForeground text-sm m-0">{t("worktrees:description")}</p>

					{/* Show in Home Screen toggle */}
					<label
						className="flex cursor-pointer items-center gap-2 text-sm text-vscode-descriptionForeground"
						onClick={handleToggleShowInHomeScreen}>
						<ToggleSwitch checked={showWorktreesInHomeScreen} onChange={handleToggleShowInHomeScreen} />
						<span>{t("worktrees:showInHomeScreen")}</span>
					</label>

					{/* New Worktree button */}
					<Button variant="secondary" className="py-1" onClick={() => setShowCreateModal(true)}>
						<Plus />
						{t("worktrees:newWorktree")}
					</Button>
				</div>
			</div>

			{/* Scrollable List Area */}
			<div className="flex-1 overflow-y-auto px-4 py-2 min-h-0">
				{isLoading ? (
					<div className="flex items-center justify-center h-48">
						<span className="codicon codicon-loading codicon-modifier-spin text-2xl" />
					</div>
				) : error ? (
					<div className="flex flex-col items-center justify-center h-48 text-vscode-errorForeground">
						<span className="codicon codicon-error text-4xl mb-4" />
						<p className="text-center">{error}</p>
					</div>
				) : (
					<div className="flex flex-col gap-1">
						{worktrees.map((worktree) => (
							<div
								key={worktree.path}
								className={`p-2.5 px-3.5 rounded-xl hover:bg-vscode-list-hoverBackground border border-transparent ${
									worktree.isCurrent
										? " bg-vscode-list-activeSelectionBackground border-vscode-list-activeSelectionForeground/20"
										: "cursor-pointer"
								}`}
								onClick={
									worktree.isCurrent ? undefined : () => handleSwitchWorktree(worktree.path, false)
								}>
								<div className="flex items-start min-[400px]:items-center justify-between gap-2 flex-col min-[400px]:flex-row overflow-hidden">
									<div className={`flex-1 min-w-0 ${worktree.isCurrent && "cursor-default"}`}>
										{/* Info */}
										<div className="flex items-center gap-2 overflow-hidden">
											<GitBranch className="size-3 shrink-0" />
											<span className="font-medium truncate">
												{worktree.branch ||
													(worktree.isDetached
														? t("worktrees:detachedHead")
														: t("worktrees:noBranch"))}
											</span>
											{worktree.isBare && (
												<Badge className="text-[0.7em] -mt-0.25 py-0.5">
													{t("worktrees:primary")}
												</Badge>
											)}
											{worktree.isLocked && (
												<StandardTooltip content={worktree.lockReason || t("worktrees:locked")}>
													<Lock className="text-vscode-charts-yellow" />
												</StandardTooltip>
											)}
										</div>
										<div className="flex gap-2 text-xs text-vscode-descriptionForeground mt-1">
											<Folder className="size-3 shrink-0 mt-0.5" />
											<span className="truncate">{worktree.path}</span>
										</div>
									</div>

									{/* Actions */}
									<div className="flex items-center gap-1 ml-3 min-[400px]:ml-0 flex-shrink-0">
										<StandardTooltip content={t("worktrees:openInNewWindow")}>
											<Button
												variant="ghost"
												size="icon"
												disabled={worktree.isCurrent}
												onClick={(e) => {
													e.stopPropagation()
													handleSwitchWorktree(worktree.path, true)
												}}>
												<SquareArrowOutUpRight />
											</Button>
										</StandardTooltip>

										<StandardTooltip content={t("worktrees:delete")}>
											<Button
												variant="ghost"
												size="icon"
												disabled={worktree.isCurrent || worktree.isBare}
												onClick={(e) => {
													e.stopPropagation()
													setDeleteWorktree(worktree)
												}}>
												<Trash className="text-destructive" />
											</Button>
										</StandardTooltip>
									</div>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Fixed Footer - Settings */}
			<div className="flex-shrink-0 flex flex-col border-t border-vscode-sideBar-background">
				{/* Worktree include status */}
				{includeStatus && (
					<div className="flex items-center gap-2 text-sm px-5 py-3 justify-between text-vscode-descriptionForeground border-t border-vscode-sideBar-background">
						{includeStatus.exists ? (
							<span>{t("worktrees:includeFileExists")}</span>
						) : (
							<>
								<span>{t("worktrees:noIncludeFile")}</span>
								{includeStatus.hasGitignore && (
									<Button
										variant="secondary"
										size="sm"
										onClick={handleCreateWorktreeInclude}
										disabled={isCreatingInclude}>
										{t("worktrees:createFromGitignore")}
									</Button>
								)}
							</>
						)}
					</div>
				)}
			</div>

			{/* Create Modal */}
			{showCreateModal && (
				<CreateWorktreeModal
					open={showCreateModal}
					onClose={() => setShowCreateModal(false)}
					onSuccess={() => {
						setShowCreateModal(false)
						fetchWorktrees()
					}}
				/>
			)}

			{/* Delete Modal */}
			{deleteWorktree && (
				<DeleteWorktreeModal
					open={!!deleteWorktree}
					onClose={() => setDeleteWorktree(null)}
					worktree={deleteWorktree}
					onSuccess={() => {
						setDeleteWorktree(null)
						fetchWorktrees()
					}}
				/>
			)}
		</div>
	)
}
