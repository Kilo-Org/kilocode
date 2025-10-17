/**
 * Hook for calculating context usage from chat messages
 */

import { useMemo } from "react"
import { useAtomValue } from "jotai"
import { calculateContextUsage, type ContextUsage } from "../../utils/context.js"
import type { ExtensionChatMessage, ProviderSettings } from "../../types/messages.js"
import { routerModelsAtom } from "../atoms/index.js"

/**
 * Hook to calculate context usage from chat messages
 * Memoizes the calculation to avoid re-computing on every render
 *
 * @param messages - Array of chat messages
 * @param apiConfig - API configuration containing model info
 * @returns Context usage information
 */
export function useContextUsage(messages: ExtensionChatMessage[], apiConfig: ProviderSettings | null): ContextUsage {
	const routerModels = useAtomValue(routerModelsAtom)

	return useMemo(() => {
		return calculateContextUsage(messages, apiConfig, routerModels)
	}, [messages, apiConfig, routerModels])
}
