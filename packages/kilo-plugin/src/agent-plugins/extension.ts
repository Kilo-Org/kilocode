export * as KiloExtension from "./extension"

import { Diagnostic } from "./diagnostic"
import { isRecord } from "./manifest"
import type { Mcp } from "./mcp"

/**
 * The Agent Plugins client extension namespace Kilo implements (spec §8). Other clients ignore it; Kilo validates it
 * and ignores any part that does not pass, so a bad entry never stops the plugin from loading.
 */
export const NAMESPACE = "ai.kilo"

/** OAuth settings a plugin may give its own remote MCP servers: public-client values only. */
export interface OAuth {
  readonly client_id?: string
  readonly callback_port?: number
  readonly redirect_uri?: string
  readonly scope?: string
}

export interface Result {
  /** Validated OAuth settings by the server name used in the plugin's mcp.json. */
  readonly oauth: ReadonlyMap<string, OAuth>
  readonly diagnostics: readonly Diagnostic.Info[]
}

const KNOWN = new Set(["mcp"])
const SERVER = new Set(["oauth"])
const OAUTH = new Set(["client_id", "callback_port", "redirect_uri", "scope"])
// A secret in a published plugin is not secret, and a metadata URL would let a plugin choose which authorization
// server receives the user's credentials.
const REFUSED = new Set(["client_secret", "auth_server_metadata_url"])

/**
 * Reads `extensions["ai.kilo"]` against the servers the plugin loaded. A plugin can only configure remote servers it
 * declares itself, and only with a loopback redirect, so the authorization code can never leave this machine.
 */
export function read(
  extensions: Readonly<Record<string, unknown>> | undefined,
  servers: readonly Mcp.Server[],
): Result {
  const value = extensions?.[NAMESPACE]
  if (value === undefined) return { oauth: new Map(), diagnostics: [] }
  const diagnostics: Diagnostic.Info[] = []
  const warn = (message: string, item?: string) =>
    diagnostics.push(
      Diagnostic.warning("extension-invalid", `Ignored ${message}`, item ? { component: "mcp", item } : undefined),
    )
  if (!isRecord(value)) {
    warn(`extensions.${NAMESPACE}: it must be an object`)
    return { oauth: new Map(), diagnostics }
  }
  for (const key of Object.keys(value).filter((key) => !KNOWN.has(key)))
    warn(`unknown field extensions.${NAMESPACE}.${key}`)
  if (value.mcp === undefined) return { oauth: new Map(), diagnostics }
  if (!isRecord(value.mcp)) {
    warn(`extensions.${NAMESPACE}.mcp: it must map server names to settings`)
    return { oauth: new Map(), diagnostics }
  }
  const oauth = new Map<string, OAuth>()
  for (const [name, settings] of Object.entries(value.mcp)) {
    const path = `extensions.${NAMESPACE}.mcp.${JSON.stringify(name)}`
    const server = servers.find((item) => item.name === name)
    if (!server) {
      warn(`${path}: it does not match a loaded server in mcp.json`, name)
      continue
    }
    if (server.transport === "stdio") {
      warn(`${path}: OAuth settings only apply to remote servers`, name)
      continue
    }
    if (!isRecord(settings)) {
      warn(`${path}: it must be an object`, name)
      continue
    }
    for (const key of Object.keys(settings).filter((key) => !SERVER.has(key)))
      warn(`unknown field ${path}.${key}`, name)
    if (settings.oauth === undefined) continue
    const checked = decodeOAuth(settings.oauth)
    if (typeof checked === "string") {
      warn(`${path}.oauth: ${checked}`, name)
      continue
    }
    for (const key of checked.unknown) warn(`unknown field ${path}.oauth.${key}`, name)
    oauth.set(name, checked.oauth)
  }
  return { oauth, diagnostics }
}

function decodeOAuth(value: unknown): { oauth: OAuth; unknown: string[] } | string {
  if (!isRecord(value)) return "it must be an object"
  const refused = Object.keys(value).find((key) => REFUSED.has(key))
  if (refused) return `${refused} is not accepted from plugins`
  if (value.client_id !== undefined && (typeof value.client_id !== "string" || value.client_id === ""))
    return "client_id must be a non-empty string"
  if (value.scope !== undefined && typeof value.scope !== "string") return "scope must be a string"
  const port = value.callback_port
  if (port !== undefined && !(typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535))
    return "callback_port must be an integer from 1 to 65535"
  if (value.redirect_uri !== undefined) {
    if (typeof value.redirect_uri !== "string" || !loopbackRedirect(value.redirect_uri))
      return "redirect_uri must be http://127.0.0.1:<port>/… or http://localhost:<port>/…"
    const redirect = new URL(value.redirect_uri)
    // Core listens on callback_port when both are set; a different redirect port would strand the browser.
    if (typeof port === "number" && redirect.port !== String(port))
      return "callback_port and the redirect_uri port must match"
  }
  return {
    oauth: Object.fromEntries(Object.entries(value).filter(([key]) => OAUTH.has(key))) as OAuth,
    unknown: Object.keys(value).filter((key) => !OAUTH.has(key)),
  }
}

/**
 * Only redirects core's callback listener can serve: it binds 127.0.0.1 on the redirect's port, so an IPv6-only
 * host or a URL without a port would send the browser somewhere nothing listens.
 */
function loopbackRedirect(value: string) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (
    url.protocol === "http:" &&
    !url.username &&
    !url.password &&
    url.port !== "" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost")
  )
}
