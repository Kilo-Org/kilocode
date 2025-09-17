// kilocode_change - new file
import { useState, useEffect } from "react"
import { vscode } from "@src/utils/vscode"

export function useKeybindings(commandIds: string[]): Record<string, string> {
	const [keybindings, setKeybindings] = useState<Record<string, string>>({})

	useEffect(() => {
		vscode.postMessage({ type: "getKeybindings", commandIds })

		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "keybindingsResponse") {
				setKeybindings(message.keybindings || {})
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [commandIds])

	return keybindings
}
