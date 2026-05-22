import { ModelStatusCache } from '../cache/model-status-cache'
import { fetchModelsDirect } from '../utils/atomic-chat-api'

const modelStatusCache = new ModelStatusCache()

export function getLoadedModels(baseURL: string = 'http://127.0.0.1:1337'): Promise<string[]> {
  return modelStatusCache.getModels(baseURL, async () => {
    return await fetchModelsDirect(baseURL)
  })
}
