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

export async function checkAtomicChatHealth(baseURL: string = DEFAULT_ATOMIC_CHAT_ORIGIN): Promise<boolean> {
  try {
    const url = buildAPIURL(baseURL)
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function discoverAtomicChatModels(baseURL: string = DEFAULT_ATOMIC_CHAT_ORIGIN): Promise<AtomicChatModel[]> {
  try {
    const url = buildAPIURL(baseURL)
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) {
      return []
    }
    const data = (await response.json()) as AtomicChatModelsResponse
    return data.data ?? []
  } catch (error) {
    throw new Error(`Failed to discover models: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function fetchModelsDirect(baseURL: string = DEFAULT_ATOMIC_CHAT_ORIGIN): Promise<string[]> {
  try {
    const url = buildAPIURL(baseURL)
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const data = (await response.json()) as AtomicChatModelsResponse
    return data.data?.map((model) => model.id) || []
  } catch (error) {
    throw new Error(
      `Failed to fetch models: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export async function autoDetectAtomicChat(): Promise<string | null> {
  for (const port of ATOMIC_CHAT_PROBE_PORTS) {
    const baseURL = `http://127.0.0.1:${port}`
    const ok = await checkAtomicChatHealth(baseURL)
    if (ok) {
      return baseURL
    }
  }
  return null
}
