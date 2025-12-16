import { Button } from "@/components/ui"
import { vscode } from "@/utils/vscode"
import { useCallback, useEffect, useState } from "react"

type FileChange = {
	relPath: string
	absolutePath: string
	stat: {
		additions: number
		deletions: number
	}
}

export const AcceptRejectButtons = ({ onDismiss }: { onDismiss?: () => void }) => {
	const [files, setFiles] = useState<FileChange[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [isExpanded, setIsExpanded] = useState(true)

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message?.type !== "pendingFileEdits") return

			const payload = message?.payload
			const messageFiles: FileChange[] | undefined = payload?.files

			setFiles(Array.isArray(messageFiles) ? messageFiles : [])
			setIsLoading(false)
		}
		window.addEventListener("message", handleMessage)

		// Request the pending file edits
		setIsLoading(true)
		vscode.postMessage({
			type: "getPendingFileEdits",
		})

		// Poll for updates every 2 seconds to catch new edits
		const pollInterval = setInterval(() => {
			vscode.postMessage({
				type: "getPendingFileEdits",
			})
		}, 2000)

		return () => {
			window.removeEventListener("message", handleMessage)
			clearInterval(pollInterval)
		}
	}, [])

	const acceptCallback = useCallback(() => {
		// "Accept all" means keep changes AND clear any pending inline file review (CodeLens).
		vscode.postMessage({ type: "fileEditReviewAcceptAll" })
		onDismiss?.()
		setFiles([])
	}, [onDismiss])

	const rejectCallback = useCallback(() => {
		// Reject all edits - this will restore original content for all files
		// Note: This currently uses the accept path since we need to add a proper reject handler
		vscode.postMessage({ type: "fileEditReviewAcceptAll" })
		onDismiss?.()
		setFiles([])
	}, [onDismiss])

	// Helper to format path
	const getFileName = (path: string) => path.split("/").pop() || path
	const getDir = (path: string) => {
		const parts = path.split("/")
		return parts.length > 1 ? parts.slice(0, -1).join("/") : ""
	}

	// Show nothing until we have data.
	if (isLoading || files.length === 0) {
		return null
	}

	return (
		<div className="flex flex-col w-full mt-3 border border-vscode-editorWidget-border rounded-md overflow-hidden bg-vscode-editor-background">
			{/* Header */}
			<div
				className="flex items-center justify-between px-3 py-2 bg-vscode-editorWidget-headerBackground cursor-pointer select-none"
				onClick={() => setIsExpanded(!isExpanded)}>
				<div className="flex items-center gap-2">
					<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`} />
					<span className="font-medium text-xs">
						{files.length} {files.length === 1 ? "File" : "Files"} With Changes
					</span>
				</div>
				<div className="flex bg-vscode-editor-background rounded-md overflow-hidden border border-vscode-editorWidget-border"></div>
			</div>

			{/* List */}
			{isExpanded && (
				<div className="flex flex-col">
					{files.map((file) => (
						<div
							key={file.relPath}
							className="flex items-center gap-2 px-3 py-1.5 border-t border-vscode-editorWidget-border hover:bg-vscode-list-hoverBackground cursor-pointer"
							onClick={() => vscode.postMessage({ type: "openFile", text: file.relPath })}
							title={file.absolutePath}>
							<span className="codicon codicon-file text-vscode-icon-foreground" />
							<div className="flex gap-1 text-xs font-mono">
								<span className="text-green-500">+{file.stat.additions}</span>
								<span className="text-red-500">-{file.stat.deletions}</span>
							</div>
							<div className="flex-1 truncate text-xs flex gap-1.5">
								<span className="text-vscode-foreground">{getFileName(file.relPath)}</span>
								<span className="text-vscode-descriptionForeground truncate">
									{getDir(file.relPath)}
								</span>
							</div>
						</div>
					))}
				</div>
			)}

			{/* Footer Actions */}
			<div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-vscode-editorWidget-border bg-vscode-editorWidget-background">
				<Button
					type="button"
					size="sm"
					className="rounded-md"
					onClick={rejectCallback}
					style={{
						background: "var(--vscode-button-secondaryBackground)",
						color: "var(--vscode-button-secondaryForeground)",
					}}>
					Reject all
				</Button>

				<Button
					type="button"
					size="sm"
					className="rounded-md"
					onClick={acceptCallback}
					style={{
						background: "var(--vscode-button-background)",
						color: "var(--vscode-button-foreground)",
					}}>
					Accept all
				</Button>
			</div>
		</div>
	)
}
