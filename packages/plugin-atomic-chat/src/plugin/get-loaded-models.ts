import { sharedModelStatusCache } from '../cache/shared-model-status-cache'
import { fetchModelsDirect } from '../utils/atomic-chat-api'

export function getLoadedModels(baseURL: string = 'http://127.0.0.1:1337'): Promise<string[]> {
  return sharedModelStatusCache.getModels(baseURL, async () => {
    return await fetchModelsDirect(baseURL)
  })
}
