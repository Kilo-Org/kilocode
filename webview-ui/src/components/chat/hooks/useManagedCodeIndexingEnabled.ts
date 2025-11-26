import { useEffect, useState } from "react"
import { vscode } from "@/utils/vscode"

export function useManagedCodeIndexingEnabled() {
	const [isEnabled, setEnabled] = useState(false)

	useEffect(() => {
		vscode.postMessage({ type: "requestManagedIndexerEnabled" as any })

		const handleMessage = (event: MessageEvent<any>) => {
			if (event.data.type === "managedIndexerEnabled") {
				setEnabled(event.data.managedIndexerEnabled === true)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	return isEnabled
}
