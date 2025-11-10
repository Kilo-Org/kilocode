import React, { useMemo } from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import type { IndexingStatus } from "@roo/ExtensionMessage"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@src/components/ui"

interface OrganizationIndexingTabProps {
	indexingStatus: IndexingStatus & {
		manifest?: {
			totalFiles: number
			totalChunks: number
			lastUpdated: string
		}
	}
	onCancelIndexing: () => void
}

export const OrganizationIndexingTab: React.FC<OrganizationIndexingTabProps> = ({
	indexingStatus,
	onCancelIndexing,
}) => {
	const { t } = useAppTranslation()

	const progressPercentage = useMemo(
		() =>
			indexingStatus.totalItems > 0
				? Math.round((indexingStatus.processedItems / indexingStatus.totalItems) * 100)
				: 0,
		[indexingStatus.processedItems, indexingStatus.totalItems],
	)

	const transformStyleString = `translateX(-${100 - progressPercentage}%)`

	return (
		<div className="space-y-4">
			<div className="text-sm text-vscode-descriptionForeground">
				<p className="mb-2">
					Organization indexing is managed automatically by Kilo Code. Your codebase is indexed on our servers
					with delta-based indexing for feature branches.
				</p>
			</div>

			{/* Status Section */}
			<div className="space-y-2">
				<h4 className="text-sm font-medium">Status</h4>
				<div className="text-sm text-vscode-descriptionForeground">
					<span
						className={cn("inline-block w-3 h-3 rounded-full mr-2", {
							"bg-gray-400": indexingStatus.systemStatus === "Standby",
							"bg-yellow-500 animate-pulse": indexingStatus.systemStatus === "Indexing",
							"bg-green-500": indexingStatus.systemStatus === "Indexed",
							"bg-red-500": indexingStatus.systemStatus === "Error",
						})}
					/>
					{t(`settings:codeIndex.indexingStatuses.${indexingStatus.systemStatus.toLowerCase()}`)}
					{indexingStatus.message ? ` - ${indexingStatus.message}` : ""}
				</div>

				{indexingStatus.systemStatus === "Indexing" && (
					<div className="mt-2">
						<ProgressPrimitive.Root
							className="relative h-2 w-full overflow-hidden rounded-full bg-secondary"
							value={progressPercentage}>
							<ProgressPrimitive.Indicator
								className="h-full w-full flex-1 bg-primary transition-transform duration-300 ease-in-out"
								style={{
									transform: transformStyleString,
								}}
							/>
						</ProgressPrimitive.Root>
					</div>
				)}
			</div>

			{/* Info Section - Show manifest data when indexed, otherwise show how it works */}
			{indexingStatus.systemStatus === "Indexed" && indexingStatus.manifest ? (
				<div className="space-y-2 p-3 bg-vscode-input-background rounded-md">
					<h4 className="text-sm font-medium">Index Information</h4>
					<div className="text-xs text-vscode-descriptionForeground space-y-1">
						<div className="flex justify-between">
							<span>Files indexed:</span>
							<span className="font-medium">{indexingStatus.manifest.totalFiles.toLocaleString()}</span>
						</div>
						<div className="flex justify-between">
							<span>Total chunks:</span>
							<span className="font-medium">{indexingStatus.manifest.totalChunks.toLocaleString()}</span>
						</div>
						<div className="flex justify-between">
							<span>Last indexed:</span>
							<span className="font-medium">
								{new Date(indexingStatus.manifest.lastUpdated).toLocaleString()}
							</span>
						</div>
					</div>
				</div>
			) : (
				<div className="space-y-2 p-3 bg-vscode-input-background rounded-md">
					<h4 className="text-sm font-medium">How it works</h4>
					<ul className="text-xs text-vscode-descriptionForeground space-y-1 list-disc list-inside">
						<li>Main branch: Full index (shared across organization)</li>
						<li>Feature branches: Only changed files indexed (99% storage savings)</li>
						<li>Automatic file watching and incremental updates</li>
						<li>Branch-aware search with deleted file handling</li>
					</ul>
				</div>
			)}

			{/* Action Buttons */}
			<div className="space-y-3">
				<div className="flex gap-2">
					{indexingStatus.systemStatus === "Indexing" && (
						<VSCodeButton appearance="secondary" onClick={onCancelIndexing}>
							{t("settings:codeIndex.cancelIndexingButton")}
						</VSCodeButton>
					)}
					{(indexingStatus.systemStatus === "Error" || indexingStatus.systemStatus === "Standby") && (
						<VSCodeButton onClick={() => vscode.postMessage({ type: "startIndexing" })}>
							Start Organization Indexing
						</VSCodeButton>
					)}
				</div>

				{/* Management Buttons */}
				<div className="space-y-2 pt-2 border-t border-vscode-dropdown-border">
					<h4 className="text-sm font-medium">Management</h4>
					<div className="flex flex-col gap-2">
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<VSCodeButton appearance="secondary" className="w-full">
									Delete Branch Index
								</VSCodeButton>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Delete Branch Index?</AlertDialogTitle>
									<AlertDialogDescription>
										This will delete all indexed data for the current branch from the server. This
										action cannot be undone. You&apos;ll need to re-index to restore the data.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction
										onClick={() => vscode.postMessage({ type: "deleteManagedBranchIndex" })}>
										Delete Branch Index
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>

						<AlertDialog>
							<AlertDialogTrigger asChild>
								<VSCodeButton appearance="secondary" className="w-full">
									Delete Entire Index
								</VSCodeButton>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Delete Entire Index?</AlertDialogTitle>
									<AlertDialogDescription>
										This will delete ALL indexed data for this project across ALL branches from the
										server. This action cannot be undone and will affect all team members.
										You&apos;ll need to re-index everything to restore the data.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction
										onClick={() =>
											vscode.postMessage({
												type: "deleteManagedProjectIndex",
											})
										}>
										Delete Entire Index
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</div>
				</div>
			</div>
		</div>
	)
}
