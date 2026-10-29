import { Mcp } from "@opencode/schema/mcp"
import type { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
export * as MarketplaceMcp from "./mcp"

import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Option, Schema } from "effect"

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

export async function configFile(directory: string, global: boolean) {
  const checked = async (file: string) => {
    if (global) return file
    const target = await resolveFile(file)
    // Repository-controlled symlinks cannot authorize writes outside the project's native config locations.
    if (!KiloConfigFiles.writeCandidates(await resolveFile(directory), false).includes(target))
      throw new McpError("conflict", `Project MCP config resolves outside its native config locations: ${file}`)
    return file
  }
  for (const candidate of KiloConfigFiles.writeCandidates(directory, global)) {
    if (
      await fs.stat(candidate).then(
        (info) => info.isFile(),
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false
          throw error
        },
      )
    )
      return checked(candidate)
  }
  return checked(path.join(directory, KiloConfigFiles.newFile))
}

export function write(input: {
  file: string
  name: string
  server: Mcp.ServerConfig
  replace: boolean
  fingerprints?: readonly string[]
  secret?: boolean
}) {
  return serialized(input.file, async (file) => {
    const text = await read(file)
    check(text, input.file, input.name, input.replace ? input.fingerprints : [])
    await save(file, text, ["mcp", "servers", input.name], input.server, input.secret)
  })
}

export function remove(input: { file: string; name: string; fingerprints?: readonly string[] }) {
  return serialized(input.file, async (file) => {
    const text = await read(file)
    if (entry(text, input.file, input.name) === undefined) return
    check(text, input.file, input.name, input.fingerprints)
    await save(file, text, ["mcp", "servers", input.name], undefined)
  })
}

/**
 * Rewrites one JSON path of a native config file through the same atomic, JSONC-preserving queue as MCP entries.
 * `update` receives the current value; returning an equal value skips the write, and `undefined` removes the key.
 */
export function updateValue(file: string, key: readonly string[], update: (current: unknown) => unknown) {
  return serialized(file, async (target) => {
    const text = await read(target)
    const errors: ParseError[] = []
    const data: unknown = parse(text, errors, { allowTrailingComma: true })
    if (errors.length > 0) throw new McpError("invalid_params", `${file} is not valid JSON; fix it first`)
    const current = key.reduce<unknown>(
      (value, part) => (value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined),
      data,
    )
    const next = update(current)
    if (JSON.stringify(next) === JSON.stringify(current)) return
    await save(target, text, [...key], next)
  })
}

export async function preflight(input: { file: string; name: string; fingerprints?: readonly string[] }) {
  return serialized(input.file, async (file) => {
    check(await read(file), input.file, input.name, input.fingerprints)
  })
}

function check(text: string, file: string, name: string, fingerprints: readonly string[] = []) {
  const current = entry(text, file, name)
  if (current !== undefined && !fingerprints.includes(serverFingerprint(current))) {
    throw new McpError("conflict", `MCP server "${name}" in ${file} is modified or not owned by this install`)
  }
}

export async function fingerprint(file: string, name: string) {
  return serialized(file, async (target) => {
    const value = entry(await read(target), file, name)
    return value === undefined ? undefined : serverFingerprint(value)
  })
}

export function serverFingerprint(value: unknown): string {
  function normalized(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalized)
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .toSorted(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, normalized(value)]),
      )
    }
    return value
  }
  return createHash("sha256")
    .update(JSON.stringify(normalized(value)))
    .digest("hex")
}

// Canonical aliases share an atomic read-modify-write queue. Other processes are not covered.
const queues = new Map<string, Promise<unknown>>()
async function serialized<A>(file: string, task: (file: string) => Promise<A>) {
  const target = await resolveFile(path.resolve(file))
  const run = (queues.get(target) ?? Promise.resolve()).catch(() => undefined).then(() => task(target))
  queues.set(target, run)
  return run.finally(() => {
    if (queues.get(target) === run) queues.delete(target)
  })
}

export async function resolveFile(file: string): Promise<string> {
  return fs.realpath(file).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
    const info = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (info?.isSymbolicLink())
      return resolveFile(path.resolve(await resolveFile(path.dirname(file)), await fs.readlink(file)))
    if (info) return fs.realpath(file)
    return path.join(await resolveFile(path.dirname(file)), path.basename(file))
  })
}

async function read(file: string) {
  return fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}"
    throw error
  })
}

function entry(text: string, file: string, name: string) {
  const errors: ParseError[] = []
  const data = parse(text, errors, { allowTrailingComma: true })
  if (errors.length > 0) throw new McpError("invalid_params", `${file} is not valid JSON; fix it first`)
  return data?.mcp?.servers?.[name]
}

// Preserve JSONC comments and formatting, replacing the target atomically for native config watchers.
async function save(file: string, text: string, key: string[], value: unknown, secret = false) {
  const next = applyEdits(text, modify(text, key, value, { formattingOptions: { tabSize: 2, insertSpaces: true } }))
  const mode = await fs.stat(file).then(
    (info) => (secret ? 0o600 : info.mode & 0o7777),
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return 0o600
      throw error
    },
  )
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, next, { mode: 0o600, flag: "wx" })
    await fs.chmod(temporary, mode)
    await fs.rename(temporary, file)
  } catch (error) {
    const cleanup = await Promise.allSettled([fs.rm(temporary, { force: true })])
    if (cleanup[0].status === "rejected") {
      throw new AggregateError([error, cleanup[0].reason], `MCP config write and temporary cleanup failed at ${file}`, {
        cause: error,
      })
    }
    throw error
  }
}
