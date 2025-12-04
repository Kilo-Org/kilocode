import { useEffect, useState } from "react"
import { vscode } from "@/utils/vscode"

export function useManagedCodeIndexingEnabled() {
	const [isEnabled, setEnabled] = useState(false)

	useEffect(() => {
		// TODO Just hook this into apiconfiguration
		// Poll the managed indexer so we get updates on enablement
		const interval = setInterval(() => {
			console.log("[useManagedCodeIndexingEnabled] requesting managed indexer state")
			vscode.postMessage({ type: "requestManagedIndexerEnabled" as any })
		}, 500)

		const handleMessage = (event: MessageEvent<any>) => {
			console.log("[useManagedCodeIndexingEnabled] received event", event)
			if (event.data.type === "managedIndexerEnabled") {
				setEnabled(event.data.managedIndexerEnabled === true)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
			clearInterval(interval)
		}
	}, [])

	return isEnabled
}
