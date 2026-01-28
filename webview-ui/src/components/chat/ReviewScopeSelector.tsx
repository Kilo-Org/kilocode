// kilocode_change - new file
import { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { GitBranch, FileText, AlertCircle } from "lucide-react"
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
	Button,
} from "@/components/ui"
import { vscode } from "@src/utils/vscode"

export type ReviewScope = "uncommitted" | "branch"

export interface ReviewScopeInfo {
	uncommitted: {
		available: boolean
		fileCount: number
		filePreview?: string[]
	}
	branch: {
		available: boolean
		currentBranch: string
		baseBranch: string
		fileCount: number
		filePreview?: string[]
	}
	error?: string
}

interface ReviewScopeSelectorProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	scopeInfo: ReviewScopeInfo | null
}

export function ReviewScopeSelector({ open, onOpenChange, scopeInfo }: ReviewScopeSelectorProps) {
	const { t } = useTranslation()
	const [selectedScope, setSelectedScope] = useState<ReviewScope>("uncommitted")

	const handleStartReview = () => {
		vscode.postMessage({
			type: "reviewScopeSelected",
			reviewScope: selectedScope,
		})
		onOpenChange(false)
	}

	const handleCancel = () => {
		onOpenChange(false)
	}

	// Determine if each option is available
	const uncommittedAvailable = scopeInfo?.uncommitted.available ?? false
	const branchAvailable = scopeInfo?.branch.available ?? false

	// Auto-select the first available option if current selection is unavailable
	const effectiveScope = useMemo((): ReviewScope => {
		if (selectedScope === "uncommitted" && !uncommittedAvailable && branchAvailable) {
			return "branch"
		}
		if (selectedScope === "branch" && !branchAvailable && uncommittedAvailable) {
			return "uncommitted"
		}
		return selectedScope
	}, [selectedScope, uncommittedAvailable, branchAvailable])

	// Check if there's anything to review
	const hasAnythingToReview = uncommittedAvailable || branchAvailable

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{t("review:scopeSelector.title", "Select Review Scope")}</DialogTitle>
					<DialogDescription>
						{t("review:scopeSelector.description", "Choose what you want to review")}
					</DialogDescription>
				</DialogHeader>

				{scopeInfo?.error ? (
					<div className="flex items-center gap-2 p-3 bg-vscode-inputValidation-errorBackground text-vscode-inputValidation-errorForeground rounded">
						<AlertCircle className="size-4 shrink-0" />
						<span className="text-sm">{scopeInfo.error}</span>
					</div>
				) : !hasAnythingToReview ? (
					<div className="flex items-center gap-2 p-3 bg-vscode-inputValidation-warningBackground text-vscode-inputValidation-warningForeground rounded">
						<AlertCircle className="size-4 shrink-0" />
						<span className="text-sm">
							{t("review:scopeSelector.nothingToReview", "No changes found to review")}
						</span>
					</div>
				) : (
					<div className="space-y-3">
						{/* Uncommitted Changes Option */}
						<label
							className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
								effectiveScope === "uncommitted" && uncommittedAvailable
									? "border-vscode-focusBorder bg-vscode-list-activeSelectionBackground"
									: uncommittedAvailable
										? "border-vscode-panel-border hover:border-vscode-focusBorder"
										: "border-vscode-panel-border opacity-50 cursor-not-allowed"
							}`}
							onClick={() => uncommittedAvailable && setSelectedScope("uncommitted")}>
							<input
								type="radio"
								name="reviewScope"
								value="uncommitted"
								checked={effectiveScope === "uncommitted"}
								onChange={() => setSelectedScope("uncommitted")}
								disabled={!uncommittedAvailable}
								className="mt-1"
							/>
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<FileText className="size-4 text-vscode-descriptionForeground" />
									<span className="font-medium">
										{t("review:scopeSelector.uncommitted", "Uncommitted changes")}
									</span>
								</div>
								<p className="text-sm text-vscode-descriptionForeground mt-1">
									{uncommittedAvailable
										? t("review:scopeSelector.uncommittedCount", "{{count}} file(s) changed", {
												count: scopeInfo?.uncommitted.fileCount ?? 0,
											})
										: t("review:scopeSelector.noUncommittedChanges", "No uncommitted changes")}
								</p>
								{uncommittedAvailable && scopeInfo?.uncommitted.filePreview && (
									<div className="mt-2 text-xs text-vscode-descriptionForeground font-mono">
										{scopeInfo.uncommitted.filePreview.slice(0, 3).map((file, i) => (
											<div key={i} className="truncate">
												{file}
											</div>
										))}
										{scopeInfo.uncommitted.filePreview.length > 3 && (
											<div className="text-vscode-textLink-foreground">
												+{scopeInfo.uncommitted.filePreview.length - 3} more
											</div>
										)}
									</div>
								)}
							</div>
						</label>

						{/* Branch Diff Option */}
						<label
							className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
								effectiveScope === "branch" && branchAvailable
									? "border-vscode-focusBorder bg-vscode-list-activeSelectionBackground"
									: branchAvailable
										? "border-vscode-panel-border hover:border-vscode-focusBorder"
										: "border-vscode-panel-border opacity-50 cursor-not-allowed"
							}`}
							onClick={() => branchAvailable && setSelectedScope("branch")}>
							<input
								type="radio"
								name="reviewScope"
								value="branch"
								checked={effectiveScope === "branch"}
								onChange={() => setSelectedScope("branch")}
								disabled={!branchAvailable}
								className="mt-1"
							/>
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<GitBranch className="size-4 text-vscode-descriptionForeground" />
									<span className="font-medium">
										{t("review:scopeSelector.branchDiff", "Branch diff")}
									</span>
								</div>
								<p className="text-sm text-vscode-descriptionForeground mt-1">
									{branchAvailable
										? t(
												"review:scopeSelector.branchDiffDescription",
												"{{currentBranch}} vs {{baseBranch}} ({{count}} file(s))",
												{
													currentBranch: scopeInfo?.branch.currentBranch ?? "",
													baseBranch: scopeInfo?.branch.baseBranch ?? "",
													count: scopeInfo?.branch.fileCount ?? 0,
												},
											)
										: t(
												"review:scopeSelector.noBranchDiff",
												"Already on base branch or no changes",
											)}
								</p>
								{branchAvailable && scopeInfo?.branch.filePreview && (
									<div className="mt-2 text-xs text-vscode-descriptionForeground font-mono">
										{scopeInfo.branch.filePreview.slice(0, 3).map((file, i) => (
											<div key={i} className="truncate">
												{file}
											</div>
										))}
										{scopeInfo.branch.filePreview.length > 3 && (
											<div className="text-vscode-textLink-foreground">
												+{scopeInfo.branch.filePreview.length - 3} more
											</div>
										)}
									</div>
								)}
							</div>
						</label>
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={handleCancel}>
						{t("common:cancel", "Cancel")}
					</Button>
					<Button variant="primary" onClick={handleStartReview} disabled={!hasAnythingToReview}>
						{t("review:scopeSelector.startReview", "Start Review")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
