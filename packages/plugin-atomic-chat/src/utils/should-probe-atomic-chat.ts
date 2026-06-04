import { ATOMIC_CHAT_PROVIDER_KEY } from '../constants'

export function getAtomicSection(config: any) {
  return config?.provider?.[ATOMIC_CHAT_PROVIDER_KEY]
}

/** User added `provider.atomic-chat` in kilo.json (explicit opt-in). */
export function hasAtomicChatProviderSection(config: any): boolean {
  return Boolean(getAtomicSection(config))
}

/** Opt-in localhost probing without a full provider block. */
export function isAtomicChatAutoDetectEnabled(config: any): boolean {
  return config?.atomicChat?.autoDetect === true
}

function modelRefUsesAtomicChat(ref: unknown): boolean {
  if (typeof ref === 'string') {
    return ref.startsWith(`${ATOMIC_CHAT_PROVIDER_KEY}/`)
  }
  if (!ref || typeof ref !== 'object') {
    return false
  }
  const record = ref as Record<string, unknown>
  return record.providerID === ATOMIC_CHAT_PROVIDER_KEY
}

/** Default or per-agent model points at Atomic Chat (explicit opt-in). */
export function isAtomicChatModelSelected(config: any): boolean {
  if (modelRefUsesAtomicChat(config?.model)) {
    return true
  }
  const modes = config?.model
  if (!modes || typeof modes !== 'object' || Array.isArray(modes)) {
    return false
  }
  for (const value of Object.values(modes)) {
    if (modelRefUsesAtomicChat(value)) {
      return true
    }
  }
  return false
}

/**
 * Network discovery (health check, GET /v1/models) runs only when the user opted in.
 * Avoids localhost HTTP for installs that never configure Atomic Chat.
 */
export function shouldProbeAtomicChat(config: any): boolean {
  return (
    hasAtomicChatProviderSection(config) ||
    isAtomicChatAutoDetectEnabled(config) ||
    isAtomicChatModelSelected(config)
  )
}
