export * as KiloMarketplaceRegistry from "./kilo"

import { KiloServer } from "@kilocode/gateway-core"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { Option, Schema } from "effect"
import type { Entry, Registry } from "./registry"

const paths = { skill: "skills", mcp: "mcps", agent: "agents" } as const

const RawParameter = Schema.Struct({
  key: Schema.String,
  name: Schema.optional(Schema.String),
  placeholder: Schema.optional(Schema.String),
  optional: Schema.optional(Schema.Boolean),
  secret: Schema.optional(Schema.Boolean),
})

const RawOption = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  prerequisites: Schema.optional(Schema.Array(Schema.String)),
  parameters: Schema.optional(Schema.Array(RawParameter)),
  content: Schema.String,
})

const RawItem = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  githubUrl: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  prerequisites: Schema.optional(Schema.Array(Schema.String)),
  parameters: Schema.optional(Schema.Array(RawParameter)),
  skills: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, content: Schema.String }))),
  content: Schema.optional(Schema.Unknown),
})

const decodeDocument = Schema.decodeUnknownOption(Schema.Struct({ items: Schema.Array(Schema.Unknown) }))
const decodeItem = Schema.decodeUnknownOption(RawItem)
const decodeOptions = Schema.decodeUnknownOption(Schema.Array(RawOption))
const decodeAgent = Schema.decodeUnknownOption(KiloMarketplaceRpc.AgentContent)

/** Frontmatter keys of a hand-written agent document that v2 understands; anything else is dropped. */
const agentKeys = new Set([
  "mode",
  "description",
  "system",
  "model",
  "color",
  "steps",
  "hidden",
  "permissions",
  "prompt",
])

export function make(input: { server?: string; fetch?: typeof fetch } = {}): Registry {
  const server = input.server ?? KiloServer.fromEnv()
  const request = input.fetch ?? fetch
  return {
    id: "kilo",
    name: "Kilo Marketplace",
    list: async (kind) => {
      const response = await request(KiloServer.apiUrl(server, "marketplace", paths[kind]), {
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`Kilo marketplace returned HTTP ${response.status}`)
      return parse(kind, await response.text())
    },
  }
}

export function parse(kind: KiloMarketplaceRpc.Kind, yaml: string): Entry[] {
  const document = decodeDocument(Bun.YAML.parse(yaml))
  if (Option.isNone(document)) throw new Error("Kilo marketplace returned an unexpected document")
  return document.value.items.flatMap((raw) => {
    const decoded = decodeItem(raw)
    if (Option.isNone(decoded)) return []
    const entry = normalize(kind, decoded.value)
    return entry ? [entry] : []
  })
}

function normalize(kind: KiloMarketplaceRpc.Kind, raw: typeof RawItem.Type): Entry | undefined {
  const options = kind === "mcp" ? mcpOptions(raw.content) : []
  const agent = kind === "agent" ? agentContent(raw.content) : undefined
  // An agent we cannot write completely is skipped, not listed and half-installed.
  if (kind === "agent" && !agent) return undefined
  return {
    item: {
      registry: "kilo",
      kind,
      id: raw.id,
      name: raw.name ?? raw.id,
      description: raw.description?.trim() ?? "",
      category: raw.category,
      author: raw.author,
      url: raw.url ?? raw.githubUrl,
      tags: raw.tags ?? [],
      prerequisites: raw.prerequisites ?? [],
      parameters: (raw.parameters ?? []).map(parameter),
      options: options.map((option) => ({
        name: option.name,
        description: option.description,
        prerequisites: option.prerequisites ?? [],
        parameters: (option.parameters ?? []).map(parameter),
      })),
      agent,
    },
    archive: kind === "skill" && typeof raw.content === "string" ? raw.content : undefined,
    payloads: options.map((option) => option.content),
    companions: kind === "mcp" ? raw.skills?.map((skill) => ({ id: skill.id, archive: skill.content })) : undefined,
  }
}

/**
 * Agents arrive either as a native object or as a hand-written frontmatter document. Both are reduced to the
 * AgentContent v2 writes, so a catalog entry never carries a field the agent loader would ignore or misread.
 */
function agentContent(content: unknown): KiloMarketplaceRpc.AgentContent | undefined {
  if (typeof content === "string") {
    const frontmatter = yaml(content)
    if (!frontmatter) return undefined
    const raw = frontmatter as Record<string, unknown>
    return agent({ ...raw, system: raw.prompt ?? raw.system })
  }
  if (!content || typeof content !== "object" || Array.isArray(content)) return undefined
  const raw = content as Record<string, unknown>
  return agent({ ...raw, system: raw.prompt ?? raw.system })
}

/** One malformed entry is skipped, never fatal: a parse error would otherwise fail the whole catalog. */
function yaml(content: string) {
  try {
    return Bun.YAML.parse(content) as unknown
  } catch {
    return undefined
  }
}

function agent(raw: Record<string, unknown>) {
  const chosen = Object.fromEntries(Object.entries(raw).filter(([key, value]) => agentKeys.has(key) && value !== undefined))
  const decoded = decodeAgent({ ...chosen, system: chosen.system })
  if (Option.isNone(decoded)) return undefined
  // The prompt is the agent document body, so content without one installs no instructions at all. That covers
  // `{}`, `{ system: "" }` and frontmatter-only content such as `{ description }`, which is why any other field
  // does not make the entry usable.
  if (!(typeof decoded.value.system === "string" && decoded.value.system.trim())) return undefined
  return decoded.value
}

function mcpOptions(content: unknown) {
  if (typeof content === "string") return [{ name: "Default", content }]
  return Option.getOrElse(decodeOptions(content), () => [])
}

function parameter(raw: typeof RawParameter.Type): KiloMarketplaceRpc.Parameter {
  return {
    key: raw.key,
    name: raw.name ?? raw.key,
    placeholder: raw.placeholder,
    optional: raw.optional ?? false,
    // Legacy catalogs lack secret metadata; mask unless they explicitly opt out.
    secret: raw.secret ?? true,
  }
}
