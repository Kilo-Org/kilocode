import { sharedModelStatusCache } from "../cache/shared-model-status-cache"
import { ToastNotifier } from "../ui/toast-notifier"
import { findSimilarModels, retryWithBackoff, categorizeError, generateAutoFixSuggestions } from "../utils"
import { getLoadedModels } from "./get-loaded-models"
import { normalizeBaseURL } from "../utils/atomic-chat-api"
import { isPluginHookInput, isAtomicChatProvider, isValidModel } from "../utils/validation"
import { DEFAULT_ATOMIC_CHAT_ORIGIN, LOG_PREFIX } from "../constants"

export function createChatParamsHook(toastNotifier: ToastNotifier) {
  return async (input: any, output: any) => {
    if (!isPluginHookInput(input)) {
      console.error(`${LOG_PREFIX} Invalid chat.params input`)
      return
    }

    const { model, provider } = input

    if (!isValidModel(model)) {
      console.error(`${LOG_PREFIX} Invalid model object`)
      return
    }

    if (!isAtomicChatProvider(provider)) {
      return
    }

    const baseURL = normalizeBaseURL(provider.options?.baseURL || DEFAULT_ATOMIC_CHAT_ORIGIN)

    let lastLoadedModels: string[] = []
    let validationAttempt = 0
    const validationResult = await retryWithBackoff(
      async () => {
        const refresh = validationAttempt > 0
        validationAttempt++
        const loadedModels = await getLoadedModels(baseURL, { refresh })
        lastLoadedModels = loadedModels
        if (!loadedModels.includes(model.id)) {
          throw new Error(`Model '${model.id}' not loaded`)
        }
        return loadedModels
      },
      3,
      500,
    )

    if (!validationResult.success || !validationResult.result) {
      const errorCategory = categorizeError(validationResult.error || "Validation operation failed", {
        baseURL,
        modelId: model.id,
      })
      const autoFixSuggestions = generateAutoFixSuggestions(errorCategory)

      console.warn(`${LOG_PREFIX} Model validation failed`, {
        model: model.id,
        error: validationResult.error,
        errorType: errorCategory.type,
        baseURL,
      })

      const availableModels =
        errorCategory.type === "offline" ? [] : lastLoadedModels.length > 0 ? lastLoadedModels : []

      const similarModels = findSimilarModels(model.id, availableModels)

      await toastNotifier.error(
        `Model '${model.id}' not ready: ${errorCategory.message}`,
        "Model Validation Failed",
        8000,
      )

      if (!output.options) {
        output.options = {}
      }
      output.options.atomicChatValidation = {
        status: "error",
        model: model.id,
        availableModels,
        errorCategory: errorCategory.type,
        severity: errorCategory.severity,
        message: errorCategory.message,
        canRetry: errorCategory.canRetry,
        autoFixAvailable: errorCategory.autoFixAvailable,
        autoFixSuggestions,
        steps:
          errorCategory.type === "not_found"
            ? [
                "1. Open Atomic Chat",
                "2. Load the model you want to use",
                "3. Confirm curl http://127.0.0.1:1337/v1/models lists that model id",
                "4. Retry in Kilo Code",
              ]
            : [
                "1. Ensure Atomic Chat is running",
                "2. Verify the API URL in kilo.json matches Atomic Chat settings",
                "3. Retry your request",
              ],
        similarModels: similarModels.map((item) => ({
          model: item.model,
          similarity: Math.round(item.similarity * 100),
          reason: item.reason,
        })),
      }
    } else {
      const cacheStats = sharedModelStatusCache.getStats()
      const cacheEntry = cacheStats.entries.find((entry) => entry.baseURL === baseURL)
      const cacheAge = cacheEntry ? cacheEntry.age : 0
      const loadedModels = validationResult.result || []

      if (!output.options) {
        output.options = {}
      }
      output.options.atomicChatValidation = {
        status: "success",
        model: model.id,
        availableModels: loadedModels,
        message: `Model '${model.id}' is listed by Atomic Chat and ready.`,
        cacheInfo: {
          age: cacheAge,
          valid: sharedModelStatusCache.isValid(baseURL),
          totalCacheEntries: cacheStats.size,
        },
        performanceHint:
          loadedModels.length > 1
            ? `Note: ${loadedModels.length} models reported. Unload unused models in Atomic Chat if performance suffers.`
            : cacheAge > 20000
              ? `Cache is ${Math.round(cacheAge / 1000)}s old; refresh if model status seems wrong.`
              : undefined,
      }
    }
  }
}
