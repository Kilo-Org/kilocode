// kilocode_change - new file
import React from "react"
import { cn } from "@src/lib/utils"

interface WorkspaceFolderState {
	workspaceFolderPath: string
	workspaceFolderName: string
	gitBranch: string | null
	projectId: string | null
	isIndexing: boolean
	hasManifest: boolean
	manifestFileCount: number
	hasWatcher: boolean
	error?: {
		type: string
		message: string
		timestamp: string
		context?: {
			filePath?: string
			branch?: string
			operation?: string
		}
	}
}

interface ManagedIndexerStatusProps {
	workspaceFolders: WorkspaceFolderState[]
}

export const ManagedIndexerStatus: React.FC<ManagedIndexerStatusProps> = ({ workspaceFolders }) => {
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return (
			<div className="p-4 text-sm text-vscode-descriptionForeground">
				No workspace folders found for managed indexing.
			</div>
		)
	}

	return (
		<div className="space-y-3">
			{workspaceFolders.map((folder) => (
				<div
					key={folder.workspaceFolderPath}
					className="p-3 bg-vscode-input-background rounded-md border border-vscode-dropdown-border">
					{/* Folder Name */}
					<div className="flex items-center justify-between mb-2">
						<h4 className="text-sm font-medium text-vscode-foreground">{folder.workspaceFolderName}</h4>
						{/* Indexing Status Indicator */}
						<span
							className={cn("inline-flex items-center gap-1.5 text-xs", {
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
										? "Ready"
										: "Standby"}
						</span>
					</div>

					{/* Folder Details */}
					<div className="space-y-1 text-xs text-vscode-descriptionForeground">
						{/* Git Branch */}
						{folder.gitBranch && (
							<div className="flex justify-between">
								<span>Branch:</span>
								<code className="font-mono text-vscode-foreground">{folder.gitBranch}</code>
							</div>
						)}

						{/* File Count */}
						{folder.hasManifest && (
							<div className="flex justify-between">
								<span>Files indexed:</span>
								<span className="font-medium text-vscode-foreground">
									{folder.manifestFileCount.toLocaleString()}
								</span>
							</div>
						)}

						{/* Error Message */}
						{folder.error && (
							<div className="mt-2 p-2 bg-vscode-inputValidation-errorBackground border border-vscode-inputValidation-errorBorder rounded text-xs">
								<div className="font-medium text-vscode-inputValidation-errorForeground mb-1">
									{folder.error.type.toUpperCase()} ERROR
								</div>
								<div className="text-vscode-descriptionForeground">{folder.error.message}</div>
								{folder.error.context?.operation && (
									<div className="text-vscode-descriptionForeground mt-1 opacity-75">
										Operation: {folder.error.context.operation}
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			))}
		</div>
	)
}
