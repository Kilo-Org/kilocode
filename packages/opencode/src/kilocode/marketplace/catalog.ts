import { parse as parseYaml } from "yaml"
import type { AgentItem, Item, McpItem, RawSkill, SkillItem, Type } from "./types"

const url = "https://api.kilo.ai/api/marketplace"
const ttl = 300_000
const retries = 3
const timeout = 10_000

type Entry = {
  data: unknown
  time: number
}

const cache = new Map<string, Entry>()

function title(input: string) {
  return input
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return parseYaml(text)
  }
}

function cached(key: string): unknown | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.time <= ttl) return entry.data
  cache.delete(key)
  return undefined
}

function save(key: string, data: unknown) {
  cache.set(key, { data, time: Date.now() })
}

async function text(input: string, attempt = 0): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const response = await fetch(input, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return await response.text()
  } catch (err) {
    clearTimeout(timer)
    if (attempt >= retries - 1) throw err
    await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)))
    return text(input, attempt + 1)
  }
}

async function fetchKind(kind: Type): Promise<Item[]> {
  const prior = cached(kind)
  if (prior) return prior as Item[]
  const raw = parse(await text(`${url}/${kind === "mcp" ? "mcps" : `${kind}s`}`)) as { items?: unknown[] }
  const list = (raw.items ?? []).map((item) => {
    if (kind !== "skill") return { ...(item as Record<string, unknown>), type: kind } as AgentItem | McpItem
    const skill = item as RawSkill
    const name = title(skill.id)
    return {
      type: "skill" as const,
      id: skill.id,
      name,
      displayName: name,
      description: skill.description,
      category: skill.category,
      displayCategory: title(skill.category),
      githubUrl: skill.githubUrl,
      content: skill.content,
    } satisfies SkillItem
  })
  save(kind, list)
  return list
}

export async function all(): Promise<{ items: Item[]; errors: string[] }> {
  const errors: string[] = []
  const settled = await Promise.all(
    (["agent", "mcp", "skill"] as const).map((kind) =>
      fetchKind(kind).catch((err: unknown) => {
        errors.push(
          `Failed to fetch ${kind === "mcp" ? "mcps" : `${kind}s`}: ${err instanceof Error ? err.message : String(err)}`,
        )
        return [] as Item[]
      }),
    ),
  )
  return { items: settled.flat(), errors }
}

export function clear() {
  cache.clear()
}
