import { Mcp } from "@opencode/schema/mcp"
import type { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Option, Schema } from "effect"

// MCP servers from the marketplace. The catalog carries each install option as a JSON string in the v1 (Claude
// Desktop style) shape with `{{KEY}}` placeholders; `build` fills the parameters and converts it to the v2
// `Mcp.ServerConfig`, which `write` stores under `mcp.servers.<id>` in a Kilo config file.

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

/**
 * The `mcp.servers` key of an item. Registry ids such as `io.github.owner/server` are reduced to letters, digits, `-`
 * and `_`, because the server name becomes part of tool names. Kilo marketplace ids already have that form.
 */
export function serverName(id: string) {
  return id.replace(/[^A-Za-z0-9_-]+/g, "-")
}

/** The parameters one install option asks for: the item's own, then the option's, the option winning on a key. */
export function parameters(item: KiloMarketplaceRpc.Item, option: KiloMarketplaceRpc.InstallOption | undefined) {
  const merged = new Map(item.parameters.map((parameter) => [parameter.key, parameter]))
  for (const parameter of option?.parameters ?? []) merged.set(parameter.key, parameter)
  return [...merged.values()]
}

/**
 * Fills `{{KEY}}` (and v1's `${KEY}`) placeholders in a raw config string and converts it to a v2 server config.
 * Values are JSON-escaped before they are substituted, so a value cannot break out of its string. Required parameters
 * must be given; empty optional values drop the environment variable or header that uses them.
 */
export function build(input: {
  template: string
  parameters: readonly KiloMarketplaceRpc.Parameter[]
  params: Readonly<Record<string, string>>
}): Mcp.ServerConfig {
  const missing = input.parameters.filter((parameter) => !parameter.optional && !input.params[parameter.key]?.trim())
  if (missing.length > 0) {
    throw new McpError("invalid_params", `Missing required parameters: ${missing.map((p) => p.name).join(", ")}`)
  }
  const values = new Map(input.parameters.map((parameter) => [parameter.key, input.params[parameter.key] ?? ""]))
  // Only visit the original template: inserted values can contain literal placeholders themselves.
  const filled = input.template.replace(/\{\{([^{}]+)\}\}|\$\{([^{}]+)\}/g, (_, current: string, legacy: string) => {
    const key = current ?? legacy
    const value = values.get(key)
    if (value === undefined)
      throw new McpError("invalid_params", `The server config uses undeclared parameters: ${key}`)
    return JSON.stringify(value).slice(1, -1)
  })
  const raw: unknown = JSON.parse(filled)
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new McpError("invalid_params", "The server config is not a JSON object")
  }
  const server = convert(raw as Record<string, unknown>)
  const decoded = decodeServer(server)
  if (Option.isNone(decoded)) throw new McpError("invalid_params", "The server config is not a valid MCP server")
  return decoded.value
}

// v1 shapes: `{ command, args, env }` for a local server, `{ type: "streamable-http" | "sse", url, headers }` for a
// remote one. A config that already uses the v2 `local`/`remote` shape passes through. v2 remote servers have no
// environment, so an `env` on a remote config is dropped.
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

/** The Kilo config file that a write goes to: the first existing write candidate, else a new `kilo2.json`. */
export async function configFile(directory: string, global: boolean) {
  for (const candidate of KiloConfigFiles.writeCandidates(directory, global)) {
    if (
      await fs.stat(candidate).then(
        (info) => info.isFile(),
        () => false,
      )
    )
      return candidate
  }
  return path.join(directory, KiloConfigFiles.newFile)
}

/** Adds `mcp.servers.<name>`. Fails with `conflict` when the entry exists and `replace` is not set. */
export function write(input: { file: string; name: string; server: Mcp.ServerConfig; replace: boolean }) {
  return serialized(input.file, async () => {
    const text = await read(input.file)
    if (!input.replace && entry(text, input.file, input.name) !== undefined) {
      throw new McpError("conflict", `MCP server "${input.name}" is already configured in ${input.file}`)
    }
    await save(input.file, text, ["mcp", "servers", input.name], input.server)
  })
}

/** Removes `mcp.servers.<name>`. A missing file or entry is not an error: the user may have removed it already. */
export function remove(input: { file: string; name: string }) {
  return serialized(input.file, async () => {
    const text = await read(input.file)
    if (entry(text, input.file, input.name) === undefined) return
    await save(input.file, text, ["mcp", "servers", input.name], undefined)
  })
}

// Read-modify-write of one config file runs one at a time in this process, so two installs started together (the
// self-test did exactly that) cannot drop each other's entry. Writers in other processes, such as `mcp add`, are not
// covered.
const queues = new Map<string, Promise<unknown>>()
function serialized<A>(file: string, task: () => Promise<A>) {
  const run = (queues.get(file) ?? Promise.resolve()).catch(() => undefined).then(task)
  queues.set(file, run)
  return run.finally(() => {
    if (queues.get(file) === run) queues.delete(file)
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
  // Refuse to edit a file that does not parse: a write could drop the user's settings.
  if (errors.length > 0) throw new McpError("invalid_params", `${file} is not valid JSON; fix it first`)
  return data?.mcp?.servers?.[name]
}

// Edits keep comments and formatting. The new text goes to a temporary file that replaces the config in one rename,
// so the config watcher never reads a half-written file.
async function save(file: string, text: string, key: string[], value: unknown) {
  const next = applyEdits(text, modify(text, key, value, { formattingOptions: { tabSize: 2, insertSpaces: true } }))
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, next, { mode: 0o600, flag: "wx" })
  await fs.rename(temporary, file)
}
