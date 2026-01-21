import { useCallback, useEffect, useRef } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { lastChatMessageAtom, chatMessagesAtom } from "../atoms/extension.js"
import {
	clearActiveSlashCommandPolicyAtom,
	clearPendingModelOverrideAtom,
	pendingModelOverrideAtom,
} from "../atoms/slashCommands.js"
import { updateProviderAtom, providerAtom } from "../atoms/config.js"
import { getModelIdKey } from "../../constants/providers/models.js"
import { logs } from "../../services/logs.js"

/**
 * Clears active slash command policy and restores model overrides
 * when a completion_result message is received.
 */
export function useSlashCommandCleanup(): void {
	const lastMessage = useAtomValue(lastChatMessageAtom)
	const pendingOverride = useAtomValue(pendingModelOverrideAtom)
	const currentProvider = useAtomValue(providerAtom)
	const chatMessages = useAtomValue(chatMessagesAtom)
	const clearPolicy = useSetAtom(clearActiveSlashCommandPolicyAtom)
	const clearOverride = useSetAtom(clearPendingModelOverrideAtom)
	const updateProvider = useSetAtom(updateProviderAtom)
	const handledCompletionRef = useRef<Set<number>>(new Set())

	const restorePendingOverride = useCallback(() => {
		if (pendingOverride && currentProvider && currentProvider.id === pendingOverride.providerId) {
			const modelKey = getModelIdKey(currentProvider.provider)
			const currentModel = currentProvider[modelKey] as string | undefined

			if (currentModel === pendingOverride.overrideModelId) {
				void updateProvider(currentProvider.id, {
					[modelKey]: pendingOverride.previousModelId,
				}).catch((error) => {
					logs.warn("Failed to restore model after slash command", "SlashCommands", { error })
				})
			}
		}

		clearOverride()
	}, [pendingOverride, currentProvider, updateProvider, clearOverride])

	useEffect(() => {
		if (!lastMessage || lastMessage.type !== "ask" || lastMessage.ask !== "completion_result") {
			return
		}

		if (handledCompletionRef.current.has(lastMessage.ts)) {
			return
		}

		handledCompletionRef.current.add(lastMessage.ts)
		clearPolicy()
		restorePendingOverride()
	}, [lastMessage, clearPolicy, restorePendingOverride])

	useEffect(() => {
		if (chatMessages.length > 0) {
			return
		}

		if (!pendingOverride) {
			return
		}

		clearPolicy()
		restorePendingOverride()
	}, [chatMessages.length, pendingOverride, clearPolicy, restorePendingOverride])
}
