import { useState, useEffect, useCallback } from "react"

import type { Worktree } from "@roo-code/types"

import { vscode } from "@/utils/vscode"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Button, Checkbox } from "@/components/ui"
import { Folder, GitBranch, TriangleAlert } from "lucide-react"

interface DeleteWorktreeModalProps {
	open: boolean
	onClose: () => void
	worktree: Worktree
	onSuccess?: () => void
}

export const DeleteWorktreeModal = ({ open, onClose, worktree, onSuccess }: DeleteWorktreeModalProps) => {
	const { t } = useAppTranslation()

	const [isDeleting, setIsDeleting] = useState(false)
	const [forceDeleteLocked, setForceDeleteLocked] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data

			if (message.type === "worktreeResult") {
				setIsDeleting(false)
				if (message.success) {
					onSuccess?.()
					onClose()
				} else {
					setError(message.text || "Unknown error")
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [onSuccess, onClose])

	const handleDelete = useCallback(() => {
		setError(null)
		setIsDeleting(true)

		// Always force delete unless worktree is locked and user hasn't opted in
		const shouldForce = worktree.isLocked ? forceDeleteLocked : true

		vscode.postMessage({
			type: "deleteWorktree",
			worktreePath: worktree.path,
			worktreeForce: shouldForce,
		})
	}, [worktree.path, worktree.isLocked, forceDeleteLocked])

	return (
		<Dialog open={open} onOpenChange={(isOpen: boolean) => !isOpen && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("worktrees:deleteWorktree")}</DialogTitle>
				</DialogHeader>

				<div className="flex flex-col gap-3 overflow-hidden">
					{/* Worktree info */}
					<div className="flex flex-col p-5 gap-2 cursor-default rounded-xl text-vscode-foreground bg-vscode-input-background">
						<p className="flex items-center gap-2 m-0">
							<GitBranch className="size-4 shrink-0" />
							<span className="font-medium truncate">
								{worktree.branch ||
									(worktree.isDetached ? t("worktrees:detachedHead") : t("worktrees:noBranch"))}
							</span>
						</p>

						<p className="flex items-start gap-2 m-0">
							<Folder className="size-4 shrink-0" />
							<span className="m-0 text-sm font-mono font-medium text-vscode-descriptionForeground">
								{worktree.path}
							</span>
						</p>
					</div>

					{/* Warning message */}
					<div className="flex items-start gap-2 px-5 py-2">
						<TriangleAlert className="size-4 text-vscode-charts-yellow flex-shrink-0" />
						<div className="flex flex-col min-w-0 gap-2">
							<p className="m-0 text-vscode-foreground">{t("worktrees:deleteWarning")}</p>
							<ul className="m-0 pl-0 list-none space-y-1 text-vscode-descriptionForeground">
								<li>• {t("worktrees:deleteWarningBranch")}</li>
								<li>• {t("worktrees:deleteWarningFiles")}</li>
							</ul>
							<p className="m-0 text-vscode-descriptionForeground">{t("worktrees:deleteNoticeLarge")}</p>
						</div>
					</div>

					{/* Force delete option (only shown if worktree is locked) */}
					{worktree.isLocked && (
						<div className="flex items-center gap-2">
							<Checkbox
								id="force-delete"
								checked={forceDeleteLocked}
								onCheckedChange={(checked) => setForceDeleteLocked(checked === true)}
							/>
							<label htmlFor="force-delete" className="text-sm text-vscode-foreground cursor-pointer">
								{t("worktrees:forceDelete")}
								<span className="text-vscode-descriptionForeground ml-1">
									({t("worktrees:worktreeIsLocked")})
								</span>
							</label>
						</div>
					)}

					{/* Error message */}
					{error && (
						<div className="flex items-center gap-2 px-2 py-1.5 rounded bg-vscode-inputValidation-errorBackground border border-vscode-inputValidation-errorBorder text-sm">
							<span className="codicon codicon-error text-vscode-errorForeground flex-shrink-0" />
							<p className="text-vscode-errorForeground">{error}</p>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="secondary" onClick={onClose}>
						{t("worktrees:cancel")}
					</Button>
					<Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
						{isDeleting ? (
							<>
								<span className="codicon codicon-loading codicon-modifier-spin mr-2" />
								{t("worktrees:deleting")}
							</>
						) : (
							t("worktrees:delete")
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
