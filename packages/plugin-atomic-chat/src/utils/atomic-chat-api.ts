import type { AtomicChatModel, AtomicChatModelsResponse } from '../types'
import { ATOMIC_CHAT_PROBE_PORTS, DEFAULT_ATOMIC_CHAT_ORIGIN } from '../constants'

const MODELS_ENDPOINT = '/v1/models'

export function normalizeBaseURL(baseURL: string = DEFAULT_ATOMIC_CHAT_ORIGIN): string {
  let normalized = baseURL.replace(/\/+$/, '')
  if (normalized.endsWith('/v1')) {
    normalized = normalized.slice(0, -3)
  }
  return normalized
}

export function buildAPIURL(baseURL: string, endpoint: string = MODELS_ENDPOINT): string {
  const normalized = normalizeBaseURL(baseURL)
  return `${normalized}${endpoint}`
}

export type ModelsEndpointResult = {
  ok: boolean
  models: AtomicChatModel[]
}

/** Single GET /v1/models — shared by health, discovery, and direct model-id fetch. */
export async function fetchModelsEndpoint(baseURL: string): Promise<ModelsEndpointResult> {
  const url = buildAPIURL(baseURL)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) {
      return { ok: false, models: [] }
    }
    const data = (await response.json()) as AtomicChatModelsResponse
    return { ok: true, models: data.data ?? [] }
  } catch (error) {
    throw new Error(
      `Failed to fetch models: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export async function checkAtomicChatHealth(baseURL: string = DEFAULT_ATOMIC_CHAT_ORIGIN): Promise<boolean> {
  try {
    const { ok } = await fetchModelsEndpoint(baseURL)
    return ok
  } catch {
    return false
  }
}

export async function discoverAtomicChatModels(baseURL: string = DEFAULT_ATOMIC_CHAT_ORIGIN): Promise<AtomicChatModel[]> {
  try {
    const { ok, models } = await fetchModelsEndpoint(baseURL)
    if (!ok) {
      return []
    }
    return models
  } catch {
    return []
  }
}

export async function fetchModelsDirect(baseURL: string = DEFAULT_ATOMIC_CHAT_ORIGIN): Promise<string[]> {
  const { ok, models } = await fetchModelsEndpoint(baseURL)
  if (!ok) {
    throw new Error('Atomic Chat models endpoint returned a non-success status')
  }
  return models.map((model) => model.id)
}

export async function autoDetectAtomicChat(): Promise<string | null> {
  for (const port of ATOMIC_CHAT_PROBE_PORTS) {
    const baseURL = `http://127.0.0.1:${port}`
    try {
      const { ok } = await fetchModelsEndpoint(baseURL)
      if (ok) {
        return baseURL
      }
    } catch {
      continue
    }
  }
  return null
}
