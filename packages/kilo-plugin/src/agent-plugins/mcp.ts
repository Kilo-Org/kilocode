export * as Mcp from "./mcp"

import { readFile, realpath } from "node:fs/promises"
import path from "node:path"
import { Diagnostic } from "./diagnostic"
import { isRecord } from "./manifest"
import { Paths } from "./paths"
import { Version } from "./version"

export type Transport = "stdio" | "streamable-http" | "sse"

/** A stdio server ready to launch: placeholders expanded, paths absolute and contained, reserved variables set. */
export interface Stdio {
  readonly name: string
  readonly transport: "stdio"
  /** A bare executable name for the platform search, or an absolute path inside the plugin root. */
  readonly command: string
  readonly args: readonly string[]
  /** The configured `env` after expansion, with `PLUGIN_ROOT` and `PLUGIN_DATA` set last (spec §9.1). */
  readonly env: Readonly<Record<string, string>>
  readonly cwd: string
}

export interface Remote {
  readonly name: string
  readonly transport: "streamable-http" | "sse"
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

export type Server = Stdio | Remote

export interface Result {
  readonly servers: readonly Server[]
  readonly diagnostics: readonly Diagnostic.Info[]
}

export interface Input {
  /** The resolved plugin root. */
  readonly root: string
  /** The Agent Plugins version declared by `plugin.json`; `mcp.json` must declare the same one (spec §10.1). */
  readonly spec: Version.Id
  readonly platform: NodeJS.Platform
  readonly transports: readonly Transport[]
  /** Creates the plugin data directory on first use and returns its resolved path, or undefined when that fails. */
  readonly data: () => Promise<string | undefined>
}

const scope = { component: "mcp" } as const
const VARIANTS = {
  stdio: new Set(["type", "command", "args", "env", "cwd"]),
  "streamable-http": new Set(["type", "url", "headers"]),
  sse: new Set(["type", "url", "headers"]),
} as const
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
// RFC 9110 field values: visible ASCII and obs-text, with interior spaces and tabs.
const FIELD_VALUE = /^(?:[\x21-\x7e\x80-\xff](?:[\x20\x09\x21-\x7e\x80-\xff]*[\x21-\x7e\x80-\xff])?)?$/

/**
 * Reads the MCP servers of a plugin from its fixed `mcp.json` location (spec §7.2). A top-level problem disables MCP
 * for the plugin; a problem with one entry skips only that server.
 */
export async function read(input: Input): Promise<Result> {
  const location = path.join(input.root, "mcp.json")
  const found = await Paths.kind(location)
  if (found === "missing") return { servers: [], diagnostics: [] }
  if (found !== "file") return disabled("mcp-invalid", '"mcp.json" is not a regular file')
  const file = await realpath(location)
  if (!Paths.contains(input.root, file)) return disabled("mcp-invalid", '"mcp.json" resolves outside the plugin root')
  const value = await readFile(file, "utf8").then(
    (text) => {
      try {
        return { parsed: JSON.parse(text) as unknown }
      } catch {
        return undefined
      }
    },
    () => undefined,
  )
  if (!value) return disabled("mcp-invalid", '"mcp.json" is not valid JSON')
  return decode(value.parsed, input)
}

/** Validates a parsed `mcp.json` value and resolves every valid server entry. */
export async function decode(value: unknown, input: Input): Promise<Result> {
  if (!isRecord(value)) return disabled("mcp-invalid", '"mcp.json" must contain a JSON object')
  const unknown = Object.keys(value).filter((key) => key !== "$schema" && key !== "mcpServers")
  if (unknown.length) return disabled("mcp-invalid", `"mcp.json" has unknown fields: ${unknown.join(", ")}`)
  if (typeof value.$schema !== "string") return disabled("mcp-invalid", '"mcp.json" requires a string "$schema"')
  const spec = Version.fromMcpSchema(value.$schema)
  if (!spec) return disabled("mcp-unsupported-version", `Unsupported Agent Plugins MCP version "${value.$schema}"`)
  if (spec !== input.spec)
    return disabled(
      "mcp-version-mismatch",
      `"mcp.json" targets Agent Plugins ${spec} but plugin.json targets ${input.spec}`,
    )
  if (!isRecord(value.mcpServers)) return disabled("mcp-invalid", '"mcpServers" must be an object')
  const results = await Promise.all(
    Object.entries(value.mcpServers).map(([name, config]) =>
      server(name, config, input).catch(
        (error: unknown): Diagnostic.Info =>
          Diagnostic.error("server-invalid", `Skipped server "${name}": ${String(error)}`, { ...scope, item: name }),
      ),
    ),
  )
  return {
    servers: results.filter((result): result is Server => "transport" in result),
    diagnostics: results.filter((result): result is Diagnostic.Info => "code" in result),
  }
}

async function server(name: string, config: unknown, input: Input): Promise<Server | Diagnostic.Info> {
  const item = { ...scope, item: name }
  const invalid = (reason: string) => Diagnostic.error("server-invalid", `Skipped server "${name}": ${reason}`, item)
  if (!isRecord(config)) return invalid("the entry must be an object")
  const type = config.type
  if (type !== "stdio" && type !== "streamable-http" && type !== "sse")
    return invalid(typeof type === "string" ? `unknown type "${type}"` : 'the entry requires a "type"')
  const extra = Object.keys(config).filter((key) => !VARIANTS[type].has(key))
  if (extra.length) return invalid(`fields not allowed for type "${type}": ${extra.join(", ")}`)
  const checked = type === "stdio" ? stdio(config, input) : remote(config)
  if (typeof checked === "string") return invalid(checked)
  if (!input.transports.includes(type))
    return Diagnostic.warning(
      "server-unsupported-transport",
      `Skipped server "${name}": transport "${type}" is not supported`,
      item,
    )
  if (checked.transport !== "stdio") return { name, ...checked }
  const data = await input.data()
  if (!data)
    return Diagnostic.error(
      "data-unavailable",
      `Skipped server "${name}": the plugin data directory could not be created`,
      item,
    )
  const resolved = await launch(checked, input.root, data)
  if (typeof resolved === "string") return invalid(resolved)
  return { name, ...resolved }
}

interface StdioConfig {
  readonly transport: "stdio"
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly cwd?: string
}

function stdio(config: Record<string, unknown>, input: Input): StdioConfig | string {
  const command = config.command
  if (typeof command !== "string" || command.length === 0) return '"command" must be a non-empty string'
  if (!command.startsWith("./") && (/[\s/\\]/.test(command) || command === "." || command === ".."))
    return '"command" must be a single bare executable name or a plugin-relative path starting with "./"'
  if (config.args !== undefined && !(Array.isArray(config.args) && config.args.every((arg) => typeof arg === "string")))
    return '"args" must be an array of strings'
  if (
    config.env !== undefined &&
    !(isRecord(config.env) && Object.values(config.env).every((v) => typeof v === "string"))
  )
    return '"env" must map names to string values'
  const env = (config.env ?? {}) as Record<string, string>
  const reserved = Object.keys(env).find((key) =>
    ["PLUGIN_ROOT", "PLUGIN_DATA"].includes(input.platform === "win32" ? key.toUpperCase() : key),
  )
  if (reserved) return `"env" must not set the reserved variable ${reserved}`
  if (config.cwd !== undefined && typeof config.cwd !== "string") return '"cwd" must be a string'
  return {
    transport: "stdio",
    command,
    args: (config.args ?? []) as string[],
    env,
    ...(typeof config.cwd === "string" ? { cwd: config.cwd } : {}),
  }
}

async function launch(config: StdioConfig, root: string, data: string): Promise<Omit<Stdio, "name"> | string> {
  const expand = (value: string) =>
    value.replace(/\$\{PLUGIN_(ROOT|DATA)\}/g, (_, key: string) => (key === "ROOT" ? root : data))
  const command = config.command.startsWith("./")
    ? await Paths.inside(root, path.resolve(root, config.command))
    : config.command
  if (!command) return '"command" resolves outside the plugin root'
  const cwd = await workingDirectory(config.cwd, expand, root, data)
  if (typeof cwd !== "string") return cwd.reason
  return {
    transport: "stdio",
    command,
    args: config.args.map(expand),
    env: {
      ...Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, expand(value)])),
      PLUGIN_ROOT: root,
      PLUGIN_DATA: data,
    },
    cwd,
  }
}

async function workingDirectory(
  cwd: string | undefined,
  expand: (value: string) => string,
  root: string,
  data: string,
): Promise<string | { reason: string }> {
  if (cwd === undefined) return root
  const rooted = (placeholder: string) => cwd === placeholder || cwd.startsWith(`${placeholder}/`)
  const base = cwd.startsWith("./") || rooted("${PLUGIN_ROOT}") ? root : rooted("${PLUGIN_DATA}") ? data : undefined
  if (!base) return { reason: '"cwd" must start with "./", "${PLUGIN_ROOT}" or "${PLUGIN_DATA}"' }
  const resolved = await Paths.inside(base, path.resolve(root, expand(cwd)))
  if (!resolved)
    return { reason: `"cwd" resolves outside the ${base === root ? "plugin root" : "plugin data directory"}` }
  return resolved
}

function remote(config: Record<string, unknown>): Omit<Remote, "name"> | string {
  const transport = config.type as Remote["transport"]
  if (typeof config.url !== "string") return '"url" must be a string'
  const url = URL.canParse(config.url) ? new URL(config.url) : undefined
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:"))
    return '"url" must be an absolute HTTP or HTTPS URL'
  if (url.username || url.password) return '"url" must not contain user information'
  if (config.url.includes("#")) return '"url" must not contain a fragment'
  if (url.protocol === "http:" && !loopback(url.hostname)) return '"url" must use HTTPS unless the host is loopback'
  if (config.headers !== undefined && !isRecord(config.headers)) return '"headers" must map names to string values'
  const headers = (config.headers ?? {}) as Record<string, unknown>
  const names = new Set<string>()
  for (const [header, value] of Object.entries(headers)) {
    if (!TOKEN.test(header)) return `"headers" has an invalid header name "${header}"`
    if (typeof value !== "string" || !FIELD_VALUE.test(value)) return `"headers" has an invalid value for "${header}"`
    if (names.has(header.toLowerCase())) return `"headers" repeats "${header}" with different casing`
    names.add(header.toLowerCase())
  }
  return { transport, url: config.url, headers: headers as Record<string, string> }
}

/** `localhost` exactly, an IPv4 address in 127.0.0.0/8, or IPv6 `::1` (the URL parser normalizes their spelling). */
export function loopback(hostname: string) {
  return hostname === "localhost" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) || hostname === "[::1]"
}

function disabled(code: Diagnostic.Code, message: string): Result {
  return { servers: [], diagnostics: [Diagnostic.error(code, `MCP disabled for this plugin: ${message}`, scope)] }
}
