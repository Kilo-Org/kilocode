import { ToastNotifier } from '../ui/toast-notifier'
import { validateConfig } from '../utils/validation'
import { enhanceConfig, shouldProbeAtomicChat } from './enhance-config'
import type { PluginInput } from '@kilocode/plugin'
import { ATOMIC_CHAT_PROVIDER_KEY, LOG_PREFIX } from '../constants'

export function createConfigHook(client: PluginInput['client'], toastNotifier: ToastNotifier) {
  return async (config: any) => {
    const section = config?.provider?.[ATOMIC_CHAT_PROVIDER_KEY]
    const initialModelCount = section?.models ? Object.keys(section.models).length : 0

    if (config && (Object.isFrozen?.(config) || Object.isSealed?.(config))) {
      console.warn(`${LOG_PREFIX} Config object is frozen/sealed - cannot modify directly`)
      return
    }

    const validation = validateConfig(config)
    if (!validation.isValid) {
      console.error(`${LOG_PREFIX} Invalid config provided:`, validation.errors)
      toastNotifier.error('Plugin configuration is invalid', 'Configuration Error').catch(() => {})
      return
    }

    if (validation.warnings.length > 0) {
      console.warn(`${LOG_PREFIX} Config warnings:`, validation.warnings)
    }

    if (!shouldProbeAtomicChat(config)) {
      return
    }

    const discoveryPromise = enhanceConfig(config, client, toastNotifier)
    const timeoutMs = 5000
    try {
      await Promise.race([
        discoveryPromise,
        new Promise<void>((resolve) => {
          setTimeout(() => resolve(), timeoutMs)
        }),
      ])
    } catch (error) {
      console.error(`${LOG_PREFIX} Config enhancement failed:`, error)
    }

    const finalSection = config?.provider?.[ATOMIC_CHAT_PROVIDER_KEY]
    const finalModelCount = finalSection?.models ? Object.keys(finalSection.models).length : 0

    if (finalModelCount === 0 && finalSection) {
      console.warn(`${LOG_PREFIX} No models discovered — Atomic Chat may be offline or no model loaded`)
    } else if (finalModelCount > 0) {
      console.log(`${LOG_PREFIX} Loaded ${finalModelCount} models (was ${initialModelCount})`)
    }
  }
}
