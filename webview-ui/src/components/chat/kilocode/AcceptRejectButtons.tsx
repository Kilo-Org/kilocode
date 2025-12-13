import { Button } from "@/components/ui"
import { vscode } from "@/utils/vscode"
import { CommitRange } from "@roo-code/types"
import { useCallback, useEffect, useState } from "react"

type FileChange = {
	relative: string
	absolute: string
	stat: {
		additions: number
		deletions: number
	}
}

export const AcceptRejectButtons = ({
	commitRange,
	onDismiss,
}: {
	commitRange: CommitRange
	onDismiss?: () => void
}) => {
	const [files, setFiles] = useState<FileChange[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [isExpanded, setIsExpanded] = useState(true)

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message?.type !== "commitChanges") return

			const payload = message?.payload
			const messageCommitRange: CommitRange | undefined = payload?.commitRange
			const messageFiles: FileChange[] | undefined = payload?.files

			if (messageCommitRange?.from !== commitRange.from) return

			setFiles(Array.isArray(messageFiles) ? messageFiles : [])
			setIsLoading(false)
		}
		window.addEventListener("message", handleMessage)

		// Request the files
		setIsLoading(true)
		vscode.postMessage({
			type: "getCommitChanges",
			payload: { commitRange },
		})

		return () => window.removeEventListener("message", handleMessage)
	}, [commitRange])

	const acceptCallback = useCallback(() => {
		// "Accept all" means keep changes AND clear any pending inline file review (CodeLens).
		vscode.postMessage({ type: "fileEditReviewAcceptAll" })
		onDismiss?.()
		setFiles([])
	}, [onDismiss])

	const rejectCallback = useCallback(() => {
		vscode.postMessage({
			type: "checkpointRestore",
			payload: {
				mode: "restore",
				ts: commitRange.fromTimeStamp ?? 0,
				commitHash: commitRange.from,
			},
		})
		onDismiss?.()
		setFiles([])
	}, [commitRange, onDismiss])

	// Helper to format path
	const getFileName = (path: string) => path.split("/").pop() || path
	const getDir = (path: string) => {
		const parts = path.split("/")
		return parts.length > 1 ? parts.slice(0, -1).join("/") : ""
	}

	// Local-only UX: show nothing until we have data.
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
							key={file.relative}
							className="flex items-center gap-2 px-3 py-1.5 border-t border-vscode-editorWidget-border hover:bg-vscode-list-hoverBackground cursor-pointer"
							onClick={() => vscode.postMessage({ type: "openFile", text: file.relative })}
							title={file.absolute}>
							<span className="codicon codicon-file text-vscode-icon-foreground" />
							<div className="flex gap-1 text-xs font-mono">
								<span className="text-green-500">+{file.stat.additions}</span>
								<span className="text-red-500">-{file.stat.deletions}</span>
							</div>
							<div className="flex-1 truncate text-xs flex gap-1.5">
								<span className="text-vscode-foreground">{getFileName(file.relative)}</span>
								<span className="text-vscode-descriptionForeground truncate">
									{getDir(file.relative)}
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
