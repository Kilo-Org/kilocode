import { useEffect, useRef } from "react"
import { useAtomValue } from "jotai"
import { mergedMessagesAtom } from "../state/atoms/ui.js"
import { getMessageKey } from "../state/atoms/message-batching.js"
import { outputJsonMessage } from "./utils/jsonOutput.js"

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
