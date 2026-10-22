export * as KiloMarketplaceRegistry from "./kilo"

import { KiloServer } from "@kilocode/gateway-core"
import type { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { Option, Schema } from "effect"
import type { Entry, Registry } from "./registry"

// The Kilo marketplace (https://github.com/Kilo-Org/kilo-marketplace), served as YAML by the Kilo API at
// `/api/marketplace/{skills,mcps,agents}`. Entries that do not decode are skipped, so one bad item cannot hide the
// catalog.
const paths = { skill: "skills", mcp: "mcps", agent: "agents" } as const

const RawParameter = Schema.Struct({
  key: Schema.String,
  name: Schema.optional(Schema.String),
  placeholder: Schema.optional(Schema.String),
  optional: Schema.optional(Schema.Boolean),
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

export function make(input: { server?: string; fetch?: typeof fetch } = {}): Registry {
  const server = input.server ?? KiloServer.fromEnv()
  const request = input.fetch ?? fetch
  return {
    id: "kilo",
    name: "Kilo Marketplace",
    description: "Skills, MCP servers and agents reviewed by Kilo",
    kinds: ["skill", "mcp", "agent"],
    curated: true,
    searchable: false,
    list: async (kind) => {
      // A hang must fail so the caller falls back to the stored catalog.
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
    return [normalize(kind, decoded.value)]
  })
}

function normalize(kind: KiloMarketplaceRpc.Kind, raw: typeof RawItem.Type): Entry {
  const options = kind === "mcp" ? mcpOptions(raw.content) : []
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
    },
    archive: kind === "skill" && typeof raw.content === "string" ? raw.content : undefined,
    payloads: kind === "mcp" ? options.map((option) => option.content) : raw.content === undefined ? [] : [raw.content],
    companions: raw.skills?.map((skill) => ({ id: skill.id, archive: skill.content })),
  }
}

// An MCP item has either one config string or a list of named options, each with its own config string.
function mcpOptions(content: unknown) {
  if (typeof content === "string") return [{ name: "Default", content }]
  return Option.getOrElse(decodeOptions(content), () => [])
}

function parameter(raw: typeof RawParameter.Type): KiloMarketplaceRpc.Parameter {
  return { key: raw.key, name: raw.name ?? raw.key, placeholder: raw.placeholder, optional: raw.optional ?? false }
}
