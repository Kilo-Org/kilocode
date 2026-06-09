import { sharedModelStatusCache } from '../cache/shared-model-status-cache'
import { fetchModelsDirect } from '../utils/atomic-chat-api'
import { DEFAULT_ATOMIC_CHAT_ORIGIN } from '../constants'

async function fetchLoadedModelIds(baseURL: string): Promise<string[]> {
  return await fetchModelsDirect(baseURL)
}

export function getLoadedModels(
  baseURL: string = DEFAULT_ATOMIC_CHAT_ORIGIN,
  options?: { refresh?: boolean }
): Promise<string[]> {
  const fetchFn = () => fetchLoadedModelIds(baseURL)
  if (options?.refresh) {
    return sharedModelStatusCache.forceRefresh(baseURL, fetchFn)
  }
  return sharedModelStatusCache.getModels(baseURL, fetchFn)
}
