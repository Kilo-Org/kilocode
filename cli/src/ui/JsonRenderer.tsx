import { useEffect, useRef } from "react"
import { useAtomValue } from "jotai"
import { mergedMessagesAtom, type UnifiedMessage } from "../state/atoms/ui.js"
import { outputJsonMessage } from "./utils/jsonOutput.js"

function getMessageKey(message: UnifiedMessage): string {
	const baseKey = `${message.source}-${message.message.ts}`
	const content = message.source === "cli" ? message.message.content : message.message.text || ""
	const partial = message.message.partial ? "partial" : "complete"
	return `${baseKey}-${content.length}-${partial}`
}

export function JsonRenderer() {
	const messages = useAtomValue(mergedMessagesAtom)
	const lastOutputKeysRef = useRef<string[]>([])

	useEffect(() => {
		const currentKeys = messages.map(getMessageKey)

		for (let i = 0; i < messages.length; i++) {
			const message = messages[i]
			const currentKey = currentKeys[i]
			const lastKey = lastOutputKeysRef.current[i]

			if (!message || !currentKey) continue

			if (currentKey !== lastKey) {
				outputJsonMessage(message)
			}
		}

		lastOutputKeysRef.current = currentKeys
	}, [messages])

	return null
}
