import { FolderNoHistoryScreen } from "@/components/welcome/screens/FolderNoHistoryScreen"
import { NoFolderNoHistoryScreen } from "@/components/welcome/screens/NoFolderNoHistoryScreen"
import { vscode } from "@/utils/vscode"
import { useEffect, useState } from "react"

export const IdeaSuggestionsBox = () => {
	const [hasOpenFolder, setHasOpenFolder] = useState<boolean>(false)
	const [hasSessionHistory, setHasSessionHistory] = useState<boolean>(false)

	useEffect(() => {
		vscode.postMessage({ type: "checkWorkspaceState" })
	}, [])

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message = event.data

			switch (message.type) {
				case "workspaceState":
					setHasOpenFolder(message.hasFolder)
					setHasSessionHistory(message.hasHistory)
					break
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	if (!hasOpenFolder && !hasSessionHistory) {
		return <NoFolderNoHistoryScreen />
	}

	if (hasOpenFolder && !hasSessionHistory) {
		return <FolderNoHistoryScreen />
	}

	return null
}
