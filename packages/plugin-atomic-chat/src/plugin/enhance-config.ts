import { sharedModelStatusCache } from '../cache/shared-model-status-cache'
import { ToastNotifier } from '../ui/toast-notifier'
import { categorizeModel, formatModelName, extractModelOwner } from '../utils'
import { normalizeBaseURL, fetchModelsEndpoint, autoDetectAtomicChat } from '../utils/atomic-chat-api'
import {
  getAtomicSection,
  hasAtomicChatProviderSection,
  isAtomicChatAutoDetectEnabled,
  shouldProbeAtomicChat,
} from '../utils/should-probe-atomic-chat'
import type { PluginInput } from '@kilocode/plugin'
import type { AtomicChatModel } from '../types'
import { ATOMIC_CHAT_PROVIDER_KEY, DEFAULT_ATOMIC_CHAT_ORIGIN, LOG_PREFIX } from '../constants'

export { shouldProbeAtomicChat } from '../utils/should-probe-atomic-chat'

function setAtomicSection(config: any, value: Record<string, unknown>) {
  if (!config.provider) {
    config.provider = {}
  }
  config.provider[ATOMIC_CHAT_PROVIDER_KEY] = value
}

export async function enhanceConfig(
  config: any,
  _client: PluginInput['client'],
  toastNotifier: ToastNotifier,
  signal?: AbortSignal
): Promise<void> {
  if (!shouldProbeAtomicChat(config) || signal?.aborted) {
    return
  }

  try {
    let atomicProvider = getAtomicSection(config)
    let baseURL: string
    let models: AtomicChatModel[] | undefined

    if (atomicProvider) {
      baseURL = normalizeBaseURL(atomicProvider.options?.baseURL || DEFAULT_ATOMIC_CHAT_ORIGIN)
    } else if (isAtomicChatAutoDetectEnabled(config)) {
      const detected = await autoDetectAtomicChat(signal)
      if (!detected || signal?.aborted) {
        return
      }
      baseURL = detected.baseURL
      models = detected.models
      setAtomicSection(config, {
        npm: '@ai-sdk/openai-compatible',
        name: 'Atomic Chat (local)',
        options: {
          baseURL: `${baseURL}/v1`,
        },
        models: {},
      })
      atomicProvider = getAtomicSection(config)
    } else {
      baseURL = normalizeBaseURL(DEFAULT_ATOMIC_CHAT_ORIGIN)
      setAtomicSection(config, {
        npm: '@ai-sdk/openai-compatible',
        name: 'Atomic Chat (local)',
        options: {
          baseURL: `${baseURL}/v1`,
        },
        models: {},
      })
      atomicProvider = getAtomicSection(config)
    }

    if (signal?.aborted) {
      return
    }

    if (models === undefined) {
      try {
        const result = await fetchModelsEndpoint(baseURL, signal)
        if (!result.ok) {
          console.warn(`${LOG_PREFIX} Atomic Chat API appears unreachable`, { baseURL })
          return
        }
        models = result.models
      } catch (error) {
        console.warn(`${LOG_PREFIX} Atomic Chat API appears unreachable`, {
          baseURL,
          error: error instanceof Error ? error.message : String(error),
        })
        return
      }
    }

    if (signal?.aborted) {
      return
    }

    if (models.length > 0) {
      const existingModels = atomicProvider?.models || {}
      const discoveredModels: Record<string, any> = {}
      let chatModelsCount = 0
      let embeddingModelsCount = 0

      for (const model of models) {
        let modelKey = model.id
        if (!/^[a-zA-Z0-9_-]+$/.test(modelKey)) {
          modelKey = model.id.replace(/[^a-zA-Z0-9_-]/g, '_')
        }

        if (!existingModels[modelKey] && !existingModels[model.id]) {
          const modelType = categorizeModel(model.id)
          const owner = extractModelOwner(model.id)
          const modelConfig: any = {
            id: model.id,
            name: formatModelName(model),
          }

          if (owner) {
            modelConfig.organizationOwner = owner
          }

          if (modelType === 'embedding') {
            embeddingModelsCount++
            modelConfig.modalities = {
              input: ['text'],
              output: ['embedding'],
            }
          } else if (modelType === 'chat') {
            chatModelsCount++
            modelConfig.modalities = {
              input: ['text', 'image'],
              output: ['text'],
            }
          }

          discoveredModels[modelKey] = modelConfig
        }
      }

      if (Object.keys(discoveredModels).length > 0) {
        const section = getAtomicSection(config)
        if (!section) {
          return
        }
        section.models = {
          ...existingModels,
          ...discoveredModels,
        }

        if (chatModelsCount === 0 && embeddingModelsCount > 0) {
          console.warn(
            `${LOG_PREFIX} Only embedding-style models detected; load a chat model in Atomic Chat for coding agents.`
          )
        }
      }
    } else {
      console.warn(`${LOG_PREFIX} No models returned from Atomic Chat. Load a model and ensure the server is running.`)
    }

    if (
      !signal?.aborted &&
      (hasAtomicChatProviderSection(config) || isAtomicChatAutoDetectEnabled(config)) &&
      models.length > 0
    ) {
      try {
        const modelIds = models.map((m) => m.id)
        await sharedModelStatusCache.getModels(baseURL, async () => modelIds)
      } catch (err) {
        console.warn(`${LOG_PREFIX} Failed to warm model status cache`, {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Unexpected error in enhanceConfig:`, error)
    toastNotifier
      .warning('Plugin configuration failed', 'Configuration Error')
      .catch((err) => {
        console.warn(`${LOG_PREFIX} Failed to show configuration warning toast`, {
          error: err instanceof Error ? err.message : String(err),
        })
      })
  }
}
