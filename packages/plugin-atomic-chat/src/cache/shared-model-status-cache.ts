import { ModelStatusCache } from './model-status-cache'

/** Single shared cache for model list lookups across plugin hooks. */
export const sharedModelStatusCache = new ModelStatusCache()
