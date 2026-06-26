import { createHash } from "node:crypto"
import { Effect, Result, Schema } from "effect"
import { parse as parseYaml } from "yaml"
import { MarketplaceManifestError } from "./errors"
import { decodeManifest } from "./manifest"
import { validateMcpMethod } from "./mcp"
import { Manifest, type Item, McpItem, McpMethod, SkillItem } from "./schema"

const decoder = new TextDecoder("utf-8", { fatal: true })
const placeholder = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g
const secret = /(?:^|[-_\s])(?:authorization|api[-_\s]?key|token|secret|password|credential|pat)(?:$|[-_\s])/i
const env = /^[A-Z_][A-Z0-9_]*$/
const digest = /^sha256:[0-9a-f]{64}$/
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface LegacyAsset {
  readonly url: string
  readonly digest: string
  readonly size: number
}

function fail(reason: MarketplaceManifestError["reason"], item?: string): never {
  throw new MarketplaceManifestError({ reason, ...(item === undefined ? {} : { item }) })
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function yaml(bytes: Uint8Array) {
  const raw = (() => {
    try {
      return decoder.decode(bytes)
    } catch {
      return fail("invalid_yaml")
    }
  })()
  const parsed = (() => {
    try {
      return parseYaml(raw) as unknown
    } catch {
      return fail("invalid_yaml")
    }
  })()
  if (!record(parsed) || !Array.isArray(parsed.items)) return fail("invalid_schema")
  return parsed.items
}

function github(value: string) {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol !== "https:" || url.hostname !== "github.com") return undefined
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent)
  if (parts.length < 6 || parts[2] !== "releases" || parts[3] !== "download") return undefined
  const owner = parts[0]
  const repo = parts[1]
  const tag = parts[4]
  const name = parts.slice(5).join("/")
  return {
    api: `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tags/${encodeURIComponent(tag)}`,
    name,
    url: url.toString(),
  }
}

function snake(value: string) {
  const next = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  if (/^[a-z][a-z0-9_]*$/.test(next)) return next
  return `p_${next || "value"}`
}

function method(value: string, fallback: string) {
  const next = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug.test(next) ? next : fallback
}

function label(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ")
}

function keys(value: unknown): ReadonlyArray<string> {
  const found = new Set<string>()
  const visit = (input: unknown) => {
    if (typeof input === "string") {
      for (const match of input.matchAll(placeholder)) found.add(match[1])
      return
    }
    if (Array.isArray(input)) {
      input.forEach(visit)
      return
    }
    if (!record(input)) return
    Object.values(input).forEach(visit)
  }
  visit(value)
  return [...found].toSorted()
}

function param(value: unknown) {
  if (!record(value)) return undefined
  const key = text(value.key)
  if (!key) return undefined
  const name = text(value.name) ?? label(key)
  const hint = [key, name, text(value.placeholder) ?? ""].join(" ")
  const sensitive = secret.test(hint)
  const type = (() => {
    if (sensitive) return "string"
    if (/(?:^|[_\s-])(?:url|uri|endpoint)(?:$|[_\s-])/.test(hint.toLowerCase())) return "url"
    if (/(?:^|[_\s-])(?:path|dir|directory|folder|file)(?:$|[_\s-])/.test(hint.toLowerCase())) return "path"
    return "string"
  })()
  return {
    key,
    id: snake(key),
    name,
    sensitive,
    definition: {
      id: snake(key),
      name,
      type,
      required: value.optional !== true,
      sensitive,
      ...(sensitive && env.test(key) ? { environment: key } : {}),
    },
  }
}

type LegacyParam = NonNullable<ReturnType<typeof param>>

function params(input: ReadonlyArray<unknown>, extra: ReadonlyArray<string>): ReadonlyArray<LegacyParam> {
  const values = new Map<string, LegacyParam>()
  for (const value of input) {
    const next = param(value)
    if (next) values.set(next.key, next)
  }
  for (const key of extra) {
    const next = param({ key })
    if (next && !values.has(key)) values.set(key, next)
  }
  return [...values.values()]
}

function render(value: string, params: ReadonlyArray<LegacyParam>) {
  const map = new Map(params.map((item) => [item.key, item]))
  return value.replace(placeholder, (_match, key: string) => {
    const item = map.get(key)
    if (!item) return `{param:${snake(key)}}`
    if (item.sensitive && env.test(item.key)) return `{env:${item.key}}`
    return `{param:${item.id}}`
  })
}

function entries(value: unknown) {
  if (!record(value)) return undefined
  if (Array.isArray(value.content)) return value.content.filter(record)
  if (typeof value.content === "string") return [value]
  return undefined
}

function json(value: unknown) {
  if (typeof value !== "string") return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function array(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function object(value: unknown, params: ReadonlyArray<LegacyParam>) {
  if (!record(value)) return undefined
  const out = Object.entries(value).flatMap(([key, item]) =>
    typeof item === "string" ? ([[key, render(item, params)]] as const) : [],
  )
  return out.length ? Object.fromEntries(out) : undefined
}

function local(cfg: Record<string, unknown>, params: ReadonlyArray<LegacyParam>) {
  const cmd = text(cfg.command)
  if (!cmd || cfg.cwd !== undefined || cmd.match(placeholder)) return undefined
  const args = array(cfg.args).map((item) => render(item, params))
  const environment = object(cfg.env ?? cfg.environment, params)
  return {
    type: "local",
    command: [cmd, ...args],
    ...(environment === undefined ? {} : { environment }),
    enabled: false,
  }
}

function remote(cfg: Record<string, unknown>, params: ReadonlyArray<LegacyParam>) {
  const url = text(cfg.url)
  if (!url || cfg.env !== undefined || cfg.environment !== undefined) return undefined
  const headers = object(cfg.headers, params)
  return {
    type: "remote",
    url: render(url, params),
    ...(headers === undefined ? {} : { headers }),
    enabled: false,
  }
}

function mcpMethod(raw: Record<string, unknown>, item: Record<string, unknown>, index: number) {
  const cfg = json(raw.content)
  if (!record(cfg)) return undefined
  const refs = new Set(keys(cfg))
  const all = params(
    [
      ...(Array.isArray(item.parameters) ? item.parameters : []),
      ...(Array.isArray(raw.parameters) ? raw.parameters : []),
    ],
    [...refs],
  ).filter((item) => refs.has(item.key))
  const template = text(cfg.command) ? local(cfg, all) : remote(cfg, all)
  if (!template) return undefined
  const used = new Set<string>()
  for (const item of all) {
    if (item?.sensitive && env.test(item.key)) used.add(item.key)
  }
  return {
    id: method(text(raw.name) ?? (index === 0 ? "default" : `method-${index + 1}`), `method-${index + 1}`),
    name: text(raw.name) ?? (index === 0 ? "Default" : `Method ${index + 1}`),
    template,
    parameters: all.map((item) => item?.definition).filter(Boolean),
    prerequisites: [...array(item.prerequisites), ...array(raw.prerequisites)],
    platforms: ["darwin", "linux", "win32"],
    auth: used.size ? { mode: "environment", environment: [...used].toSorted() } : { mode: "none" },
    warnings: { writes: false },
  }
}

function skill(raw: unknown, assets: ReadonlyMap<string, LegacyAsset>) {
  if (!record(raw)) return fail("invalid_schema")
  const id = text(raw.id)
  const description = text(raw.description)
  if (!id || !description) return fail("invalid_schema")
  const content = text(raw.content)
  const asset = content ? assets.get(content) : undefined
  const category = text(raw.category)
  const source = text(raw.githubUrl) ?? text(raw.rawUrl)
  return {
    kind: "skill",
    id,
    description,
    ...(source === undefined ? {} : { source_url: source }),
    installability: asset
      ? { installable: true }
      : { installable: false, reason: "Skill artifact metadata is unavailable." },
    ...(category && slug.test(category) ? { tags: [category] } : {}),
    ...(asset
      ? {
          artifact: {
            url: content,
            digest: asset.digest,
            size: asset.size,
            format: "tar.gz",
          },
        }
      : {}),
  }
}

function mcp(raw: unknown) {
  if (!record(raw)) return fail("invalid_schema")
  const id = text(raw.id)
  const name = text(raw.name)
  const description = text(raw.description)
  if (!id || !description) return fail("invalid_schema")
  const content = entries(raw)
  const methods = content
    ? content.flatMap((item, index) => {
        const next = mcpMethod(item, raw, index)
        return next ? [next] : []
      })
    : []
  const tags = array(raw.tags)
  const category = text(raw.category)
  return {
    kind: "mcp",
    id,
    ...(name === undefined ? {} : { name }),
    description,
    ...(text(raw.url) ? { source_url: text(raw.url) } : {}),
    installability: methods.length
      ? { installable: true }
      : { installable: false, reason: "Marketplace MCP has no supported installation methods." },
    ...(tags.length ? { tags } : category && slug.test(category) ? { tags: [category] } : {}),
    methods,
  }
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function quarantine(item: McpItem): Effect.Effect<McpItem> {
  return Effect.gen(function* () {
    const methods: McpMethod[] = []
    for (const method of item.methods) {
      const result = yield* Effect.result(validateMcpMethod(item, method))
      if (Result.isSuccess(result)) methods.push(method)
    }
    if (methods.length) return { ...item, methods }
    return {
      ...item,
      methods,
      installability: { installable: false, reason: "Marketplace MCP has no safe installation methods." },
    }
  })
}

// Strip structurally-invalid MCP methods from a raw item so a single malformed
// method (for example an environment name with a hyphen, or an empty env value)
// cannot fail the strict manifest decode. Mirrors the post-decode quarantine,
// but runs before the manifest is validated so one bad resource never forces a
// stale-cache fallback for the entire Marketplace.
function sanitizeMcp(item: Record<string, unknown>): Record<string, unknown> {
  const methods = Array.isArray(item.methods) ? item.methods.filter(record) : []
  const kept: unknown[] = []
  for (const method of methods) {
    try {
      Schema.decodeUnknownSync(McpMethod)(method, { onExcessProperty: "error" })
      kept.push(method)
    } catch {
      // drop a method whose template or parameter shape fails the schema
    }
  }
  if (kept.length === methods.length) return item
  return {
    ...item,
    methods: kept,
    installability: kept.length
      ? { installable: true }
      : { installable: false, reason: "Marketplace MCP has no supported installation methods." },
  }
}

// Decode each raw item against its own schema and keep only the ones that pass
// (MCPs first have invalid methods stripped), so the manifest decode always
// receives a clean item array instead of failing on the first malformed entry.
function sanitize(items: ReadonlyArray<unknown>): ReadonlyArray<Record<string, unknown>> {
  const out: Record<string, unknown>[] = []
  for (const entry of items) {
    if (!record(entry)) continue
    const candidate = entry.kind === "mcp" ? sanitizeMcp(entry) : entry
    const schema = candidate.kind === "mcp" ? McpItem : SkillItem
    try {
      Schema.decodeUnknownSync(schema)(candidate, { onExcessProperty: "error" })
      out.push(candidate)
    } catch {
      // drop an item that still fails its schema after method stripping
    }
  }
  return out
}

export namespace LegacyMarketplace {
  export const releases = Effect.fn("Marketplace.Legacy.releases")(function* (bytes: Uint8Array) {
    return yield* Effect.try({
      try: () => {
        const apis = new Set<string>()
        for (const raw of yaml(bytes)) {
          if (!record(raw)) continue
          const content = text(raw.content)
          const release = content ? github(content) : undefined
          if (release) apis.add(release.api)
        }
        return [...apis].toSorted()
      },
      catch: (error) =>
        error instanceof MarketplaceManifestError ? error : new MarketplaceManifestError({ reason: "invalid_schema" }),
    })
  })

  export function assets(input: unknown): ReadonlyArray<LegacyAsset> {
    if (!record(input) || !Array.isArray(input.assets)) return fail("invalid_schema")
    return input.assets.flatMap((raw) => {
      if (!record(raw)) return []
      const url = text(raw.browser_download_url)
      const hash = text(raw.digest)
      const size = typeof raw.size === "number" && Number.isSafeInteger(raw.size) && raw.size > 0 ? raw.size : undefined
      if (!url || !hash || !digest.test(hash) || !size) return []
      return [{ url, digest: hash, size }]
    })
  }

  export const decode = Effect.fn("Marketplace.Legacy.decode")(function* (input: {
    readonly skills: Uint8Array
    readonly mcps: Uint8Array
    readonly assets: ReadonlyMap<string, LegacyAsset>
  }) {
    const raw = yield* Effect.try({
      try: () => [...yaml(input.skills).map((item) => skill(item, input.assets)), ...yaml(input.mcps).map(mcp)],
      catch: (error) =>
        error instanceof MarketplaceManifestError ? error : new MarketplaceManifestError({ reason: "invalid_schema" }),
    })
    const safe = sanitize(raw)
    const manifest = yield* Schema.decodeUnknownEffect(Manifest)(
      { version: 1, revision: fingerprint(safe), items: safe },
      { onExcessProperty: "error" },
    ).pipe(Effect.mapError(() => new MarketplaceManifestError({ reason: "invalid_schema" })))
    const items: Item[] = []
    for (const item of manifest.items) {
      if (item.kind === "skill") {
        items.push(item)
        continue
      }
      items.push(yield* quarantine(item))
    }
    return yield* decodeManifest({ ...manifest, revision: fingerprint(items), items })
  })
}
