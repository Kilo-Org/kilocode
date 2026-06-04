import type { AtomicChatModel, AtomicChatModelsResponse } from '../types'
import { ATOMIC_CHAT_PROBE_PORTS, DEFAULT_ATOMIC_CHAT_ORIGIN, LOG_PREFIX } from '../constants'

const MODELS_ENDPOINT = '/v1/models'
const FETCH_TIMEOUT_MS = 3000

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

export type AutoDetectResult = {
  baseURL: string
  models: AtomicChatModel[]
}

function fetchSignal(outer?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  if (!outer) {
    return timeout
  }
  return AbortSignal.any([outer, timeout])
}

/** Single GET /v1/models — shared by discovery, health, auto-detect, and chat validation. */
export async function fetchModelsEndpoint(
  baseURL: string,
  signal?: AbortSignal
): Promise<ModelsEndpointResult> {
  const url = buildAPIURL(baseURL)
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: fetchSignal(signal),
  })
  if (!response.ok) {
    return { ok: false, models: [] }
  }
  const data = (await response.json()) as AtomicChatModelsResponse
  return { ok: true, models: data.data ?? [] }
}

export async function checkAtomicChatHealth(
  baseURL: string = DEFAULT_ATOMIC_CHAT_ORIGIN,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const { ok } = await fetchModelsEndpoint(baseURL, signal)
    return ok
  } catch (error) {
    console.warn(`${LOG_PREFIX} Health check failed`, {
      baseURL,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export async function discoverAtomicChatModels(
  baseURL: string = DEFAULT_ATOMIC_CHAT_ORIGIN,
  signal?: AbortSignal
): Promise<AtomicChatModel[]> {
  try {
    const { ok, models } = await fetchModelsEndpoint(baseURL, signal)
    return ok ? models : []
  } catch (error) {
    console.warn(`${LOG_PREFIX} Model discovery failed`, {
      baseURL,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export async function fetchModelsDirect(
  baseURL: string = DEFAULT_ATOMIC_CHAT_ORIGIN,
  signal?: AbortSignal
): Promise<string[]> {
  const { ok, models } = await fetchModelsEndpoint(baseURL, signal)
  if (!ok) {
    throw new Error('Atomic Chat models endpoint returned a non-success status')
  }
  return models.map((model) => model.id)
}

/** Probes local ports; returns the first reachable server and its model list (one HTTP call). */
export async function autoDetectAtomicChat(signal?: AbortSignal): Promise<AutoDetectResult | null> {
  for (const port of ATOMIC_CHAT_PROBE_PORTS) {
    if (signal?.aborted) {
      return null
    }
    const baseURL = `http://127.0.0.1:${port}`
    try {
      const { ok, models } = await fetchModelsEndpoint(baseURL, signal)
      if (ok) {
        return { baseURL, models }
      }
    } catch (error) {
      console.warn(`${LOG_PREFIX} Auto-detect probe failed for port ${port}`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return null
}
