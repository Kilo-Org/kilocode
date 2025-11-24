import { useEffect, useState } from "react"
import { vscode } from "@/utils/vscode"

export function useManagedCodeIndexingEnabled() {
	const [isEnabled, setEnabled] = useState(false)

	useEffect(() => {
		// TODO Just hook this into apiconfiguration
		// Poll the managed indexer so we get updates on enablement
		const interval = setInterval(() => {
			vscode.postMessage({ type: "requestManagedIndexerEnabled" as any })
		}, 1000)

		const handleMessage = (event: MessageEvent<any>) => {
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
