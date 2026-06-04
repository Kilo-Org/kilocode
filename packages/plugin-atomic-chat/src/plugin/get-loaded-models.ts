import { sharedModelStatusCache } from '../cache/shared-model-status-cache'
import { fetchModelsDirect } from '../utils/atomic-chat-api'
import { DEFAULT_ATOMIC_CHAT_ORIGIN } from '../constants'

export function getLoadedModels(baseURL: string = DEFAULT_ATOMIC_CHAT_ORIGIN): Promise<string[]> {
  return sharedModelStatusCache.getModels(baseURL, async () => {
    return await fetchModelsDirect(baseURL)
  })
}
