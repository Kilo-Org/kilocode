export * as KiloMcpIdentity from "./mcp-identity.js"

export type Target =
  | { readonly kind: "remote"; readonly url: string }
  | { readonly kind: "package"; readonly ecosystem: "npm" | "pypi"; readonly identifier: string }

export interface Connection {
  readonly target: Target
  /** The version the launcher command pins; absent when the command leaves it open. */
  readonly version: string | null
}

export interface Allowed {
  readonly identityKey: string
  readonly config:
    | { readonly kind: "remote" }
    | { readonly kind: "package"; readonly min_version?: string | null }
}

export type Reason = "not_allowed" | "below_min_version" | "unsupported_target"

export interface Verdict {
  readonly decision: "allowed" | "denied"
  readonly reason?: Reason
  /** Absent when the server can never be allowlisted. */
  readonly identityKey?: string
  /** The organization's minimum version, present with `below_min_version`. */
  readonly minVersion?: string
}

/** The parts of an MCP server config that decide its identity. */
export type ServerConfig =
  | { readonly type: "remote"; readonly url: string }
  | { readonly type: "local"; readonly command: readonly string[] }

// These rules mirror the Kilo Cloud allow list, which decides the same identities when a connect is reported.
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
const PYPI_PACKAGE_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/
const MAX_NPM_NAME_LENGTH = 214
const MAX_PYPI_NAME_LENGTH = 100
const MAX_IDENTITY_KEY_LENGTH = 500
const NPM_SPEC = /^(@[^/@:\s]+\/[^/@:\s]+|[^/@:\s]+)(?:@(.+))?$/
const PYPI_SPEC =
  /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[A-Za-z0-9,._-]+\])?(?:(?:==|>=|@)([0-9][^\s,;]*)|@latest)?$/
const NPX_FLAGS = new Set(["-y", "--yes"])

/** The connection a server config makes, or undefined when it runs something an allow list cannot name. */
export function connection(config: ServerConfig): Connection | undefined {
  if (config.type === "remote") return { target: { kind: "remote", url: config.url }, version: null }
  const launched = parseLauncher(config.command)
  if (!launched) return undefined
  return {
    target: { kind: "package", ecosystem: launched.ecosystem, identifier: launched.identifier },
    version: launched.version,
  }
}

/** Decides one connection against the allow list; an undefined connection is never allowlistable. */
export function evaluate(allowed: readonly Allowed[], input: Connection | undefined): Verdict {
  if (!input) return { decision: "denied", reason: "unsupported_target" }
  const identity = identify(input.target)
  if (!identity) return { decision: "denied", reason: "unsupported_target" }
  const server = allowed.find((entry) => entry.identityKey === identity.identityKey)
  if (!server) return { decision: "denied", reason: "not_allowed", identityKey: identity.identityKey }
  const minimum = server.config.kind === "package" ? server.config.min_version : undefined
  if (minimum && input.version && isVersionAtLeast(input.version, minimum) !== true)
    return { decision: "denied", reason: "below_min_version", identityKey: identity.identityKey, minVersion: minimum }
  return { decision: "allowed", identityKey: identity.identityKey }
}

/** The target as the allow list knows it, or undefined when it can never be allowlisted. */
export function identify(target: Target) {
  const normalized = normalize(target)
  if (!normalized) return undefined
  const identityKey = key(normalized)
  if (identityKey.length > MAX_IDENTITY_KEY_LENGTH) return undefined
  return { target: normalized, identityKey }
}

export function normalizeUrl(input: string) {
  const trimmed = input.trim()
  if (trimmed.includes("{") || trimmed.includes("}")) return undefined
  if (!URL.canParse(trimmed)) return undefined
  const url = new URL(trimmed)
  if (url.protocol !== "https:" || url.username || url.password) return undefined
  return `https://${url.host}${url.pathname.replace(/\/+$/, "")}`
}

export function normalizePackage(ecosystem: "npm" | "pypi", input: string) {
  const trimmed = input.trim()
  if (ecosystem === "npm")
    return trimmed.length > MAX_NPM_NAME_LENGTH || !NPM_PACKAGE_NAME.test(trimmed.toLowerCase()) ? undefined : trimmed
  return trimmed.length > MAX_PYPI_NAME_LENGTH || !PYPI_PACKAGE_NAME.test(trimmed) ? undefined : trimmed
}

export function key(target: Target) {
  if (target.kind === "remote") return `remote:${target.url}`
  if (target.ecosystem === "npm") return `npm:${target.identifier.toLowerCase()}`
  return `pypi:${target.identifier.toLowerCase().replace(/[-_.]+/g, "-")}`
}

/** Compares the leading numeric segments only, so `1.2.0rc1` counts as `1.2.0`. Null when either has none. */
export function isVersionAtLeast(version: string, minimum: string) {
  const actual = numericParts(version)
  const required = numericParts(minimum)
  if (!actual || !required) return null
  for (let index = 0; index < Math.max(actual.length, required.length); index++) {
    const difference = (actual[index] ?? 0) - (required[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return true
}

function normalize(target: Target): Target | undefined {
  if (target.kind === "remote") {
    const url = normalizeUrl(target.url)
    return url ? { kind: "remote", url } : undefined
  }
  const identifier = normalizePackage(target.ecosystem, target.identifier)
  return identifier ? { kind: "package", ecosystem: target.ecosystem, identifier } : undefined
}

function numericParts(version: string) {
  const match = /^v?(\d+(?:\.\d+)*)/i.exec(version.trim())
  return match ? match[1].split(".").map(Number) : null
}

interface Launched {
  readonly ecosystem: "npm" | "pypi"
  readonly identifier: string
  readonly version: string | null
}

/** Recognizes the package launchers whose argument names what runs; anything else cannot be verified. */
export function parseLauncher(argv: readonly string[]): Launched | undefined {
  const [rawCommand, ...args] = argv
  if (!rawCommand || /[\\/]/.test(rawCommand)) return undefined
  const command = rawCommand.replace(/\.(cmd|exe)$/i, "").toLowerCase()
  if (command === "npx") return nodeRunner(args, NPX_FLAGS)
  if (command === "bunx") return nodeRunner(args, new Set())
  if (command === "pnpm") return args[0] === "dlx" ? nodeRunner(args.slice(1), new Set()) : undefined
  if (command === "uvx") return uvxRunner(args)
  if (command === "uv") return args[0] === "tool" && args[1] === "run" ? uvxRunner(args.slice(2)) : undefined
  return undefined
}

function nodeRunner(args: readonly string[], flags: ReadonlySet<string>) {
  const spec = firstPackageToken(args, flags)
  if (!spec) return undefined
  const match = NPM_SPEC.exec(spec)
  if (!match) return undefined
  const identifier = normalizePackage("npm", match[1])
  return identifier ? { ecosystem: "npm" as const, identifier, version: versionHint(match[2]) } : undefined
}

function uvxRunner(args: readonly string[]) {
  const spec = uvxSpec(args)
  if (!spec) return undefined
  const match = PYPI_SPEC.exec(spec)
  if (!match) return undefined
  const identifier = normalizePackage("pypi", match[1])
  return identifier ? { ecosystem: "pypi" as const, identifier, version: versionHint(match[2]) } : undefined
}

function uvxSpec(args: readonly string[]) {
  for (const [index, arg] of args.entries()) {
    if (arg === "--from") return args[index + 1]
    if (arg.startsWith("--from=")) return arg.slice("--from=".length)
    if (arg.startsWith("-")) return undefined
    return arg
  }
  return undefined
}

function firstPackageToken(args: readonly string[], flags: ReadonlySet<string>) {
  for (const arg of args) {
    if (!arg.startsWith("-")) return arg
    if (!flags.has(arg)) return undefined
  }
  return undefined
}

function versionHint(version: string | undefined) {
  return version !== undefined && /^[0-9]/.test(version) ? version : null
}
