import { Mcp } from "@opencode/schema/mcp"
import type { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { Option, Schema } from "effect"
import { MarketplaceConfig } from "./config"
export * as MarketplaceMcp from "./mcp"

export { configFile, resolveFile } from "./config"

// Translate catalog templates to native Mcp.ServerConfig, stored under mcp.servers.<id>.
export class McpError extends Error {
  constructor(
    readonly reason: "invalid_params" | "conflict" | "not_found",
    message: string,
  ) {
    super(message)
  }
}

const decodeServer = Schema.decodeUnknownOption(Mcp.ServerConfig)
const REMOTE_TYPES = new Set(["remote", "http", "streamable-http", "streamableHttp", "sse"])

export function serverName(id: string) {
  return id.replace(/[^A-Za-z0-9_-]+/g, "-")
}

/** Option-specific parameters override shared parameters with the same key. */
export function parameters(item: KiloMarketplaceRpc.Item, option: KiloMarketplaceRpc.InstallOption | undefined) {
  const merged = new Map(item.parameters.map((parameter) => [parameter.key, parameter]))
  for (const parameter of option?.parameters ?? []) merged.set(parameter.key, parameter)
  return [...merged.values()]
}

export function build(input: {
  template: string
  parameters: readonly KiloMarketplaceRpc.Parameter[]
  params: Readonly<Record<string, string>>
}): Mcp.ServerConfig {
  const missing = input.parameters.filter((parameter) => !parameter.optional && !input.params[parameter.key]?.trim())
  if (missing.length > 0) {
    throw new McpError("invalid_params", `Missing required parameters: ${missing.map((p) => p.name).join(", ")}`)
  }
  const values = new Map(
    input.parameters.map((parameter) => [parameter.key, input.params[parameter.key]?.trim() ?? ""]),
  )
  // Visit only the original template: inserted values can themselves contain literal placeholders.
  const filled = input.template.replace(
    /\{\{([^{}]+)\}\}|\$\{([^{}]+)\}/g,
    (placeholder, current: string, legacy: string) => {
      const key = current ?? legacy
      const value = values.get(key)
      if (value === undefined && current === undefined) return placeholder
      if (value === undefined)
        throw new McpError("invalid_params", `The server config uses undeclared parameters: ${key}`)
      return JSON.stringify(value).slice(1, -1)
    },
  )
  const decodedJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(filled)
  if (Option.isNone(decodedJson)) throw new McpError("invalid_params", "The server config is not valid JSON")
  const raw = decodedJson.value
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new McpError("invalid_params", "The server config is not a JSON object")
  }
  const decoded = decodeServer(convert(raw as Record<string, unknown>))
  if (Option.isNone(decoded)) throw new McpError("invalid_params", "The server config is not a valid MCP server")
  return decoded.value
}

function convert(raw: Record<string, unknown>) {
  if (raw.type === "local" && Array.isArray(raw.command)) {
    const { environment, ...config } = raw
    return { ...config, ...optionalRecord("environment", environment ?? raw.env) }
  }
  if (typeof raw.url === "string" && (raw.type === undefined || REMOTE_TYPES.has(String(raw.type)))) {
    const { headers, ...config } = raw
    return { ...config, type: "remote", ...optionalRecord("headers", headers) }
  }
  if (typeof raw.command === "string") {
    const args = Array.isArray(raw.args) ? raw.args.map(String) : []
    return { type: "local", command: [raw.command, ...args], ...optionalRecord("environment", raw.env) }
  }
  throw new McpError("invalid_params", "The server config has neither a command nor a URL")
}

function optionalRecord(key: string, value: unknown) {
  if (!value || typeof value !== "object") return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([name, item]) => [name, String(item)] as const)
    .filter(([, item]) => item !== "")
  return entries.length > 0 ? { [key]: Object.fromEntries(entries) } : {}
}

export function write(input: {
  file: string
  name: string
  server: Mcp.ServerConfig
  replace: boolean
  fingerprints?: readonly string[]
  secret?: boolean
}) {
  return MarketplaceConfig.serialized(input.file, async (file) => {
    const text = await MarketplaceConfig.read(file)
    check(text, input.file, input.name, input.replace ? input.fingerprints : [])
    await MarketplaceConfig.save(file, text, ["mcp", "servers", input.name], input.server, input.secret)
  })
}

export function remove(input: { file: string; name: string; fingerprints?: readonly string[] }) {
  return MarketplaceConfig.serialized(input.file, async (file) => {
    const text = await MarketplaceConfig.read(file)
    if (entry(text, input.file, input.name) === undefined) return
    check(text, input.file, input.name, input.fingerprints)
    await MarketplaceConfig.save(file, text, ["mcp", "servers", input.name], undefined)
  })
}

export async function preflight(input: { file: string; name: string; fingerprints?: readonly string[] }) {
  return MarketplaceConfig.serialized(input.file, async (file) => {
    check(await MarketplaceConfig.read(file), input.file, input.name, input.fingerprints)
  })
}

function check(text: string, file: string, name: string, fingerprints: readonly string[] = []) {
  const current = entry(text, file, name)
  if (current !== undefined && !fingerprints.includes(serverFingerprint(current))) {
    throw new McpError("conflict", `MCP server "${name}" in ${file} is modified or not owned by this install`)
  }
}

export async function fingerprint(file: string, name: string) {
  return MarketplaceConfig.serialized(file, async (target) => {
    const value = entry(await MarketplaceConfig.read(target), file, name)
    return value === undefined ? undefined : serverFingerprint(value)
  })
}

export function serverFingerprint(value: unknown): string {
  return MarketplaceConfig.fingerprintValue(value)
}

function entry(text: string, file: string, name: string) {
  const data = MarketplaceConfig.parseConfig(text, file) as { mcp?: { servers?: Record<string, unknown> } } | undefined
  return data?.mcp?.servers?.[name]
}
