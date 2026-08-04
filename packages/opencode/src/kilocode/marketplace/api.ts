import { parse as parseYaml } from "yaml"
import * as Log from "@opencode-ai/core/util/log"
import type {
  AgentMarketplaceItem,
  McpMarketplaceItem,
  MarketplaceItem,
  RawSkill,
  SkillMarketplaceItem,
} from "./schema"

const DEFAULT_BASE_URL = "https://api.kilo.ai/api/marketplace"
const CACHE_TTL = 300_000
const MAX_RETRIES = 3
const TIMEOUT = 10_000

const log = Log.create({ service: "marketplace" })

type Fetch = typeof fetch

type CacheEntry = {
  data: unknown
  time: number
}

export type FetchOptions = {
  fetch?: Fetch
  baseUrl?: string
}

const cache = new Map<string, CacheEntry>()

// Read the base URL per call (not at module load) so a test/enterprise override via
// KILO_MARKETPLACE_BASE_URL is honored regardless of import order.
function baseUrl(opts: FetchOptions) {
  return opts.baseUrl ?? process.env["KILO_MARKETPLACE_BASE_URL"] ?? DEFAULT_BASE_URL
}

export function kebabToTitleCase(str: string): string {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function parseResponse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return parseYaml(text)
  }
}

function transformSkill(raw: RawSkill): SkillMarketplaceItem {
  const display = kebabToTitleCase(raw.id)
  return {
    type: "skill",
    id: raw.id,
    name: display,
    displayName: display,
    description: raw.description,
    category: raw.category,
    displayCategory: kebabToTitleCase(raw.category),
    githubUrl: raw.githubUrl,
    content: raw.content,
    ...(raw.suggest_for ? { suggest_for: raw.suggest_for } : {}),
  }
}

function cached(key: string): unknown | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.time > CACHE_TTL) {
    cache.delete(key)
    return undefined
  }
  return entry.data
}

function store(key: string, data: unknown) {
  cache.set(key, { data, time: Date.now() })
}

async function fetchText(url: string, kind: string, fetcher: Fetch, attempt = 0): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  const started = Date.now()
  try {
    log.info("catalog request", { kind, url, attempt })
    const response = await fetcher(url, { signal: controller.signal })
    clearTimeout(timer)
    log.info("catalog response", { kind, url, status: response.status, duration: Date.now() - started })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return await response.text()
  } catch (err) {
    clearTimeout(timer)
    if (attempt >= MAX_RETRIES - 1) {
      log.warn("catalog request failed", { kind, url, attempt, err })
      throw err
    }
    log.warn("catalog request retry", { kind, url, attempt, err })
    await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)))
    return fetchText(url, kind, fetcher, attempt + 1)
  }
}

async function fetchKind<T>(kind: string, path: string, map: (item: Record<string, unknown>) => T, opts: FetchOptions) {
  const root = baseUrl(opts)
  const key = `${root}:${kind}`
  const hit = cached(key)
  if (hit) {
    log.info("catalog cache hit", { kind })
    return hit as T[]
  }

  const url = `${root}/${path}`
  const text = await fetchText(url, kind, opts.fetch ?? fetch)
  const parsed = parseResponse(text) as { items?: unknown[] }
  const items = (parsed.items ?? []) as Array<Record<string, unknown>>
  const result = items.map(map)
  store(key, result)
  log.info("catalog fetched", { kind, count: result.length, cacheHit: false })
  return result
}

export async function fetchAgents(opts: FetchOptions = {}): Promise<AgentMarketplaceItem[]> {
  return fetchKind("agents", "agents", (item) => ({ ...item, type: "agent" }) as AgentMarketplaceItem, opts)
}

export async function fetchMcps(opts: FetchOptions = {}): Promise<McpMarketplaceItem[]> {
  return fetchKind("mcps", "mcps", (item) => ({ ...item, type: "mcp" }) as McpMarketplaceItem, opts)
}

export async function fetchSkills(opts: FetchOptions = {}): Promise<SkillMarketplaceItem[]> {
  return fetchKind("skills", "skills", (item) => transformSkill(item as RawSkill), opts)
}

export async function fetchAll(opts: FetchOptions = {}): Promise<{ items: MarketplaceItem[]; errors: string[] }> {
  const errors: string[] = []
  const settled = await Promise.all([
    fetchAgents(opts).catch((err: unknown) => {
      errors.push(`Failed to fetch agents: ${err instanceof Error ? err.message : String(err)}`)
      return [] as AgentMarketplaceItem[]
    }),
    fetchMcps(opts).catch((err: unknown) => {
      errors.push(`Failed to fetch mcps: ${err instanceof Error ? err.message : String(err)}`)
      return [] as McpMarketplaceItem[]
    }),
    fetchSkills(opts).catch((err: unknown) => {
      errors.push(`Failed to fetch skills: ${err instanceof Error ? err.message : String(err)}`)
      return [] as SkillMarketplaceItem[]
    }),
  ])
  log.info("catalog complete", { count: settled.reduce((sum, items) => sum + items.length, 0), errors: errors.length })
  return { items: [...settled[0], ...settled[1], ...settled[2]], errors }
}

export function clearCache() {
  cache.clear()
}
