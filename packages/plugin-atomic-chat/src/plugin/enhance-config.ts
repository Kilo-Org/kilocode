import { ModelStatusCache } from '../cache/model-status-cache'
import { ToastNotifier } from '../ui/toast-notifier'
import { categorizeModel, formatModelName, extractModelOwner } from '../utils'
import {
  normalizeBaseURL,
  checkAtomicChatHealth,
  discoverAtomicChatModels,
  autoDetectAtomicChat,
} from '../utils/atomic-chat-api'
import {
  getAtomicSection,
  hasAtomicChatProviderSection,
  isAtomicChatAutoDetectEnabled,
  shouldProbeAtomicChat,
} from '../utils/should-probe-atomic-chat'
import type { PluginInput } from '@kilocode/plugin'
import type { AtomicChatModel } from '../types'
import { ATOMIC_CHAT_PROVIDER_KEY, LOG_PREFIX } from '../constants'

export { shouldProbeAtomicChat } from '../utils/should-probe-atomic-chat'

const modelStatusCache = new ModelStatusCache()

function setAtomicSection(config: any, value: Record<string, unknown>) {
  if (!config.provider) {
    config.provider = {}
  }
  config.provider[ATOMIC_CHAT_PROVIDER_KEY] = value
}

export async function enhanceConfig(
  config: any,
  _client: PluginInput['client'],
  toastNotifier: ToastNotifier
): Promise<void> {
  if (!shouldProbeAtomicChat(config)) {
    return
  }

  try {
    let atomicProvider = getAtomicSection(config)
    let baseURL: string

    if (atomicProvider) {
      baseURL = normalizeBaseURL(atomicProvider.options?.baseURL || 'http://127.0.0.1:1337')
    } else if (isAtomicChatAutoDetectEnabled(config)) {
      const detectedURL = await autoDetectAtomicChat()
      if (!detectedURL) {
        return
      }
      baseURL = detectedURL
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
      // Model references atomic-chat but provider block is missing — use default origin only.
      baseURL = normalizeBaseURL('http://127.0.0.1:1337')
      if (!atomicProvider) {
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
    }

    const isHealthy = await checkAtomicChatHealth(baseURL)
    if (!isHealthy) {
      console.warn(`${LOG_PREFIX} Atomic Chat API appears unreachable`, { baseURL })
      return
    }

    let models: AtomicChatModel[]
    try {
      models = await discoverAtomicChatModels(baseURL)
    } catch (error) {
      console.warn(`${LOG_PREFIX} Model discovery failed`, {
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

    if (models.length > 0) {
      const existingModels = atomicProvider.models || {}
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
          console.warn(`${LOG_PREFIX} Only embedding-style models detected; load a chat model in Atomic Chat for coding agents.`)
        }
      }
    } else {
      console.warn(`${LOG_PREFIX} No models returned from Atomic Chat. Load a model and ensure the server is running.`)
    }

    if (hasAtomicChatProviderSection(config) || isAtomicChatAutoDetectEnabled(config)) {
      try {
        await modelStatusCache.getModels(baseURL, async () => {
          return await discoverAtomicChatModels(baseURL).then((m) => m.map((x) => x.id))
        })
      } catch {
        // non-fatal
      }
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Unexpected error in enhanceConfig:`, error)
    toastNotifier.warning('Plugin configuration failed', 'Configuration Error').catch(() => {})
  }
}
