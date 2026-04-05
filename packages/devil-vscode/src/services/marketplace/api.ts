import { parse as parseYaml } from "yaml"
import type { MarketplaceItem, McpMarketplaceItem, ModeMarketplaceItem, SkillMarketplaceItem, RawSkill } from "./types"

const BASE_URL = "https://api.kilo.ai/api/marketplace"
const CACHE_TTL = 300_000
const MAX_RETRIES = 3
const TIMEOUT = 10_000

interface CacheEntry {
  data: unknown
  timestamp: number
}

export function kebabToTitleCase(str: string): string {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function parseResponse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return parseYaml(text)
  }
}

function transformSkill(raw: RawSkill): SkillMarketplaceItem {
  const display = kebabToTitleCase(raw.id)
  return {
    type: "skill" as const,
    id: raw.id,
    name: display,
    displayName: display,
    description: raw.description,
    category: raw.category,
    displayCategory: kebabToTitleCase(raw.category),
    githubUrl: raw.githubUrl,
    content: raw.content,
  }
}

async function fetchWithRetry(url: string, attempt = 0): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)

  try {
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return await response.text()
  } catch (err) {
    clearTimeout(timer)
    if (attempt >= MAX_RETRIES - 1) throw err
    const delay = 1000 * Math.pow(2, attempt)
    await new Promise((resolve) => setTimeout(resolve, delay))
    return fetchWithRetry(url, attempt + 1)
  }
}

export class MarketplaceApiClient {
  private cache = new Map<string, CacheEntry>()

  private getCached(key: string): unknown | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(key)
      return undefined
    }
    return entry.data
  }

  private setCache(key: string, data: unknown): void {
    this.cache.set(key, { data, timestamp: Date.now() })
  }

  private async fetchModes(): Promise<ModeMarketplaceItem[]> {
    const cached = this.getCached("modes")
    if (cached) return cached as ModeMarketplaceItem[]

    const text = await fetchWithRetry(`${BASE_URL}/modes`)
    const parsed = parseResponse(text) as { items?: unknown[] }
    const items = (parsed.items ?? []) as Array<Record<string, unknown>>
    const result = items.map((item) => ({ ...item, type: "mode" as const }) as ModeMarketplaceItem)
    this.setCache("modes", result)
    return result
  }

  private async fetchMcps(): Promise<McpMarketplaceItem[]> {
    const cached = this.getCached("mcps")
    if (cached) return cached as McpMarketplaceItem[]

    const text = await fetchWithRetry(`${BASE_URL}/mcps`)
    const parsed = parseResponse(text) as { items?: unknown[] }
    const items = (parsed.items ?? []) as Array<Record<string, unknown>>
    const result = items.map((item) => ({ ...item, type: "mcp" as const }) as McpMarketplaceItem)
    this.setCache("mcps", result)
    return result
  }

  private async fetchSkills(): Promise<SkillMarketplaceItem[]> {
    const cached = this.getCached("skills")
    if (cached) return cached as SkillMarketplaceItem[]

    const text = await fetchWithRetry(`${BASE_URL}/skills`)
    const parsed = parseResponse(text) as { items?: unknown[] }
    const items = (parsed.items ?? []) as RawSkill[]
    const result = items.map(transformSkill)
    this.setCache("skills", result)
    return result
  }

  async fetchAll(): Promise<{ items: MarketplaceItem[]; errors: string[] }> {
    const errors: string[] = []

    const settled = await Promise.all([
      this.fetchModes().catch((err: unknown) => {
        errors.push(`Failed to fetch modes: ${err instanceof Error ? err.message : String(err)}`)
        return [] as ModeMarketplaceItem[]
      }),
      this.fetchMcps().catch((err: unknown) => {
        errors.push(`Failed to fetch mcps: ${err instanceof Error ? err.message : String(err)}`)
        return [] as McpMarketplaceItem[]
      }),
      this.fetchSkills().catch((err: unknown) => {
        errors.push(`Failed to fetch skills: ${err instanceof Error ? err.message : String(err)}`)
        return [] as SkillMarketplaceItem[]
      }),
    ])

    return {
      items: [...settled[0], ...settled[1], ...settled[2]],
      errors,
    }
  }

  clearCache(): void {
    this.cache.clear()
  }

  dispose(): void {
    this.cache.clear()
  }
}
