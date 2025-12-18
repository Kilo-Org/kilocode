import { useEffect, useState } from "react"
import { vscode } from "@/utils/vscode"
import { type ManagedIndexerState, parseManagedIndexerStateMessage } from "../kilocode/managedIndexerSchema"

/**
 * Default/initial state for the managed indexer
 */
const DEFAULT_STATE: ManagedIndexerState = {
	isEnabled: false,
	isActive: false,
	workspaceFolders: [],
}

export function useManagedIndexerState(): ManagedIndexerState {
	const [state, setState] = useState<ManagedIndexerState>(DEFAULT_STATE)

	useEffect(() => {
		// Request initial state
		vscode.postMessage({ type: "requestManagedIndexerState" as any })

		const handleMessage = (event: MessageEvent<any>) => {
			if (event.data.type === "managedIndexerState") {
				// New message format - has full state
				const parsed = parseManagedIndexerStateMessage(event.data)
				if (parsed) {
					setState(parsed)
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	return state
}

export function useIsIndexing(): boolean {
	const { workspaceFolders } = useManagedIndexerState()
	return workspaceFolders.some((folder) => folder.isIndexing)
}
