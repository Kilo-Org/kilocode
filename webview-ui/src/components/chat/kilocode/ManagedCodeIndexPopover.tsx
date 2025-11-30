// kilocode_change - new file
import React, { useState, useEffect } from "react"

import { vscode } from "@src/utils/vscode"
import { ManagedIndexerStatus } from "./ManagedIndexerStatus"

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

export const ManagedCodeIndexPopoverContent: React.FC = () => {
	const [workspaceFolders, setWorkspaceFolders] = useState<WorkspaceFolderState[]>([])

	// Request initial state when popover opens
	// Listen for managed indexer state updates
	useEffect(() => {
		console.log("[ManagedCodeIndexPopoverContent] requesting managed indexer state")
		vscode.postMessage({ type: "requestManagedIndexerState" })

		const handleMessage = (event: MessageEvent<any>) => {
			console.log("[ManagedCodeIndexPopoverContent] received event", event)
			if (event.data.type === "managedIndexerState") {
				setWorkspaceFolders(event.data.managedIndexerState || [])
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	return (
		<>
			<div>
				<h4 className="mt-0">
					<span className="inline-block mr-2">🧪</span> Heads up!
				</h4>
				<p>
					This feature is experimental. Keep in mind that the UI does not update in real-time and must be
					opened and closed to see the new state.
				</p>
				<ManagedIndexerStatus workspaceFolders={workspaceFolders} />
			</div>
		</>
	)
}
