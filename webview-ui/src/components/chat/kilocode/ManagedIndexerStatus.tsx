// kilocode_change - new file
import React, { useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@src/lib/utils"
import { type WorkspaceFolderState } from "./managedIndexerSchema"

interface ManagedIndexerStatusProps {
	workspaceFolders: WorkspaceFolderState[]
}

export const ManagedIndexerStatus: React.FC<ManagedIndexerStatusProps> = ({ workspaceFolders }) => {
	// Track expanded state for each folder - default to expanded if only one folder
	const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
		if (workspaceFolders.length === 1) {
			return new Set([workspaceFolders[0].workspaceFolderPath])
		}
		return new Set()
	})

	const toggleFolder = (path: string) => {
		setExpandedFolders((prev) => {
			const next = new Set(prev)
			if (next.has(path)) {
				next.delete(path)
			} else {
				next.add(path)
			}
			return next
		})
	}

	if (!workspaceFolders || workspaceFolders.length === 0) {
		return (
			<div className="p-4 text-sm text-vscode-descriptionForeground">
				No workspace folders found for managed indexing.
			</div>
		)
	}

	return (
		<div className="space-y-2">
			{workspaceFolders.map((folder) => {
				const isExpanded = expandedFolders.has(folder.workspaceFolderPath)

				return (
					<div
						key={folder.workspaceFolderPath}
						className="bg-vscode-input-background rounded-md border border-vscode-dropdown-border overflow-hidden">
						{/* Compact Header - Always Visible */}
						<button
							onClick={() => toggleFolder(folder.workspaceFolderPath)}
							className="w-full px-3 py-2 flex items-center gap-2 hover:bg-vscode-list-hoverBackground transition-colors">
							{/* Caret Icon */}
							<ChevronRight
								className={cn(
									"w-4 h-4 text-vscode-descriptionForeground transition-transform flex-shrink-0",
									{
										"transform rotate-90": isExpanded,
									},
								)}
							/>

							{/* Folder Name */}
							<h4
								className="text-sm font-medium text-vscode-foreground flex-1 text-left truncate m-0"
								title={folder.workspaceFolderName}>
								{folder.workspaceFolderName}
							</h4>

							{/* Indexing Status Indicator */}
							<span
								className={cn("inline-flex items-center gap-1.5 text-xs flex-shrink-0", {
									"text-yellow-500": folder.isIndexing,
									"text-green-500": !folder.isIndexing && folder.hasManifest && !folder.error,
									"text-red-500": folder.error,
									"text-gray-400": !folder.isIndexing && !folder.hasManifest && !folder.error,
								})}>
								<span
									className={cn("w-2 h-2 rounded-full", {
										"bg-yellow-500 animate-pulse": folder.isIndexing,
										"bg-green-500": !folder.isIndexing && folder.hasManifest && !folder.error,
										"bg-red-500": folder.error,
										"bg-gray-400": !folder.isIndexing && !folder.hasManifest && !folder.error,
									})}
								/>
								{folder.isIndexing
									? "Indexing"
									: folder.error
										? "Error"
										: folder.hasManifest
											? "Indexed"
											: "Standby"}
							</span>
						</button>

						{/* Expanded Details */}
						{isExpanded && (
							<div className="px-3 pb-3 space-y-1 text-xs text-vscode-descriptionForeground border-t border-vscode-dropdown-border">
								{/* Git Branch */}
								{folder.gitBranch && (
									<div className="flex justify-between pt-2">
										<span>Branch:</span>
										<code className="font-mono text-vscode-foreground">{folder.gitBranch}</code>
									</div>
								)}

								{/* Repository URL */}
								{folder.repositoryUrl && (
									<div className="flex justify-between">
										<span>Repository:</span>
										<code
											className="font-mono text-vscode-foreground text-right truncate max-w-[200px]"
											title={folder.repositoryUrl}>
											{folder.repositoryUrl}
										</code>
									</div>
								)}

								{/* Project ID */}
								{folder.projectId && (
									<div className="flex justify-between">
										<span>Project ID:</span>
										<code className="font-mono text-vscode-foreground">{folder.projectId}</code>
									</div>
								)}

								{/* File Count */}
								{folder.hasManifest && Boolean(folder.manifestFileCount) && (
									<div className="flex justify-between">
										<span>Files indexed:</span>
										<span className="font-medium text-vscode-foreground">
											{folder.manifestFileCount.toLocaleString()}
										</span>
									</div>
								)}

								{/* Watcher Status */}
								<div className="flex justify-between">
									<span>File watcher:</span>
									<span className="font-medium text-vscode-foreground">
										{folder.hasWatcher ? "Active" : "Inactive"}
									</span>
								</div>

								{/* Error Message */}
								{folder.error && (
									<div className="mt-2 p-2 bg-vscode-inputValidation-errorBackground border border-vscode-inputValidation-errorBorder rounded">
										<div className="font-medium text-vscode-inputValidation-errorForeground mb-1">
											{folder.error.type.toUpperCase()} ERROR
										</div>
										<div className="text-vscode-descriptionForeground">{folder.error.message}</div>
										{folder.error.context?.operation && (
											<div className="text-vscode-descriptionForeground mt-1 opacity-75">
												Operation: {folder.error.context.operation}
											</div>
										)}
										{folder.error.context?.branch && (
											<div className="text-vscode-descriptionForeground mt-1 opacity-75">
												Branch: {folder.error.context.branch}
											</div>
										)}
									</div>
								)}
							</div>
						)}
					</div>
				)
			})}
		</div>
	)
}
