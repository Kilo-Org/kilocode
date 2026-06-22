// kilocode_change - new file
// Kilo Marketplace API client for browsing installable skills.
// Ported from packages/kilo-vscode/src/services/marketplace/api.ts so the
// CLI/TUI can browse skills without depending on the VS Code extension.
// JSON-only parsing to avoid adding a `yaml` runtime dependency to the
// shared opencode package; the marketplace API returns JSON.

export const BASE_URL = "https://api.kilo.ai/api/marketplace"
const CACHE_TTL = 300_000
const MAX_RETRIES = 3
const TIMEOUT = 10_000

interface CacheEntry {
  data: SkillItem[]
  timestamp: number
}

export interface RawSkill {
  id: string
  description: string
  category: string
  githubUrl: string
  content: string
}

export interface SkillItem {
  id: string
  name: string
  displayName: string
  description: string
  category: string
  displayCategory: string
  githubUrl: string
  content: string
}

export function kebabToTitleCase(str: string): string {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function transformSkill(raw: RawSkill): SkillItem {
  const display = kebabToTitleCase(raw.id)
  return {
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

function parseResponse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { items: [] }
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

export class Client {
  private cache = new Map<string, CacheEntry>()

  private getCached(key: string): SkillItem[] | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(key)
      return undefined
    }
    return entry.data
  }

  private setCache(key: string, data: SkillItem[]): void {
    this.cache.set(key, { data, timestamp: Date.now() })
  }

  async skills(): Promise<{ items: SkillItem[]; error?: string }> {
    const cached = this.getCached("skills")
    if (cached) return { items: cached }

    try {
      const text = await fetchWithRetry(`${BASE_URL}/skills`)
      const parsed = parseResponse(text) as { items?: RawSkill[] }
      const raw = parsed.items ?? []
      const items = raw.map(transformSkill)
      this.setCache("skills", items)
      return { items }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { items: [], error: `Failed to fetch skills: ${message}` }
    }
  }

  dispose(): void {
    this.cache.clear()
  }
}

export const client = new Client()

export * as Marketplace from "./marketplace"
