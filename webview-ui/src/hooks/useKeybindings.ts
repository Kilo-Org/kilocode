// kilocode_change - new file
import { useState, useEffect, useMemo } from "react"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@/i18n/TranslationContext"

export function useKeybindings(commandIds: string[]): Record<string, string> {
	const [keybindings, setKeybindings] = useState<Record<string, string>>({})
	const { t } = useAppTranslation()

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

	// Apply fallback for missing keybindings
	const keybindingsWithFallback = useMemo(() => {
		const result: Record<string, string> = {}
		const fallbackText = t("kilocode:ghost.settings.keybindingNotFound")
		for (const commandId of commandIds) {
			result[commandId] = keybindings[commandId] || fallbackText
		}
		return result
	}, [keybindings, commandIds, t])

	return keybindingsWithFallback
}
