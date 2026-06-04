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
  } catch {
    return { ok: false, models: [] }
  }
}

export async function checkAtomicChatHealth(baseURL: string = DEFAULT_ATOMIC_CHAT_ORIGIN): Promise<boolean> {
  const { ok } = await fetchModelsEndpoint(baseURL)
  return ok
}

export async function discoverAtomicChatModels(baseURL: string = DEFAULT_ATOMIC_CHAT_ORIGIN): Promise<AtomicChatModel[]> {
  const { ok, models } = await fetchModelsEndpoint(baseURL)
  if (!ok) {
    return []
  }
  return models
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
    const { ok } = await fetchModelsEndpoint(baseURL)
    if (ok) {
      return baseURL
    }
  }
  return null
}
