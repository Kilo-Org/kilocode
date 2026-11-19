// The Browser section's view model: the permission table and the origin field, kept apart from the JSX so the mapping
// from the rules the host stores is testable. A rule names one class of one origin (`<class>:<origin>`); a class is
// resolved as the CLI resolves it — the last matching rule wins, catch-alls included — and one no rule matches shows
// the CLI's default: allow on the localhost family, ask elsewhere.
import type { PermissionSavedInfo } from "@opencode/client"
import type { BrowserSettingsState, BrowserSettingsStatus } from "../../../../src/protocol"
import { defaultAllow } from "../../../../src/shared/browser-permissions"
import { matchAction } from "./permission-utils"

export type Effect = "allow" | "ask" | "deny"
export type Grant = "read" | "act" | "navigate"
export type Rule = BrowserSettingsState["rules"][number]

export const GRANTS: readonly Grant[] = ["read", "act", "navigate"]

/** One origin of the table, with the effect of every class. */
export type Site = { origin: string } & Record<Grant, Effect>

/** A resource as its parts: an origin carries a colon of its own, so only the first one splits. */
export function parse(resource: string): { grant: Grant; origin: string } | undefined {
  const index = resource.indexOf(":")
  if (index <= 0 || index === resource.length - 1) return undefined
  const grant = resource.slice(0, index)
  if (!GRANTS.includes(grant as Grant)) return undefined
  return { grant: grant as Grant, origin: resource.slice(index + 1) }
}

/**
 * The permission table: one row per origin in the order the rules first name it, with every class resolved the way
 * the CLI resolves it — the last rule matching `<class>:<origin>` wins, so a catch-all written after an origin rule
 * overrides it and one written before does not, and a class no rule matches shows the default: allow on the localhost
 * family, ask elsewhere. The allow-all catch-all is the separate toggle, not a row.
 */
export function sites(rules: Rule[]): Site[] {
  const rows = new Map<string, Site>()
  for (const rule of rules) {
    if (rule.action !== "browser" || rule.resource === "*") continue
    const parts = parse(rule.resource)
    if (!parts || rows.has(parts.origin)) continue
    rows.set(parts.origin, {
      origin: parts.origin,
      read: resolved(rules, "read", parts.origin),
      act: resolved(rules, "act", parts.origin),
      navigate: resolved(rules, "navigate", parts.origin),
    })
  }
  return [...rows.values()]
}

/**
 * The extension status row: the tools turned off, no hub running, a hub waiting for the extension (unpaired, or with
 * "Allow local agents" off), or the browser and profile of the connected extension.
 */
export type ExtensionRow = { kind: "off" } | { kind: "none" } | { kind: "waiting" } | { kind: "connected"; label: string }

export function extensionRow(
  backend: BrowserSettingsState["backend"] | undefined,
  extension: BrowserSettingsStatus["extension"],
): ExtensionRow {
  if (backend === "off") return { kind: "off" }
  if (extension.state !== "connected") return { kind: extension.state }
  return {
    kind: "connected",
    label: extension.profile ? `${extension.browser} (${extension.profile})` : extension.browser,
  }
}

/** One class of one origin a chat saved with "Allow always": a row of the project's `permission` table. */
export type SavedGrant = { id: string; grant: Grant; origin: string }

/**
 * The browser grants a chat saved for the project, by origin and then in class order. Saved grants are checked after
 * the config rules (`core/src/permission.ts`), so each one allows its class whatever the table above says.
 */
export function savedGrants(rows: readonly PermissionSavedInfo[]): SavedGrant[] {
  return rows
    .flatMap((row) => {
      const parts = row.action === "browser" ? parse(row.resource) : undefined
      return parts ? [{ id: row.id, ...parts }] : []
    })
    .sort((a, b) => a.origin.localeCompare(b.origin) || GRANTS.indexOf(a.grant) - GRANTS.indexOf(b.grant))
}

/**
 * The effect the CLI resolves for one class of one origin: the last rule whose resource matches the class's pattern
 * wins, and a class no rule names keeps the CLI's default. The webview cannot import core, so `matchAction` mirrors
 * its wildcard matcher.
 */
function resolved(rules: Rule[], grant: Grant, origin: string): Effect {
  const resource = `${grant}:${origin}`
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]
    if (rule.action !== "browser") continue
    if (matchAction(resource, rule.resource)) return rule.effect
  }
  return defaultAllow(origin) ? "allow" : "ask"
}

/**
 * The port the protocol spells in an origin, or `null` when no browser can report one: the URL parser's value drops
 * leading zeros and a default port, and it refuses a port above 65535 — such a rule could never match. A wildcard
 * host has no URL to parse, so its numeric port is bounded here.
 */
function portOf(scheme: string, host: string, port: string): string | undefined | null {
  if (port === "*") return "*"
  // A wildcard host has no URL to parse, so its numeric port is bounded here; a leading zero could never match.
  if (host.includes("*")) {
    if (port.length > 1 && port.startsWith("0")) return null
    if (Number(port) > 65535) return null
    // The CLI matches origins as a URL spells them, and a URL drops the scheme's default port. A wildcard host has no
    // URL of its own, so the same default is dropped here; keeping it would make the rule match nothing.
    if ((scheme === "https" && port === "443") || (scheme === "http" && port === "80")) return undefined
    return port
  }
  try {
    return new URL(`${scheme}://${host}:${port}`).port || undefined
  } catch {
    return null
  }
}

/**
 * The origin the Add field turns into rules, or why it cannot be one. An origin is a scheme, a host and an optional
 * port: a path, a query and a fragment would never match the protocol's origin, so they are refused here. A default
 * port is dropped, because `https://example.com:443` and `https://example.com` are the same origin and the protocol
 * spells it without the port.
 */
export function origin(
  input: string,
  existing: readonly string[] = [],
): { value: string } | { error: "empty" | "invalid" | "duplicate" } {
  const value = input.trim().replace(/\/$/, "").toLowerCase()
  if (value.length === 0) return { error: "empty" }
  const match = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9*](?:[a-z0-9.*-]*[a-z0-9*])?)(?::(\d{1,5}|\*))?$/.exec(value)
  if (!match) return { error: "invalid" }
  const port = match[3] === undefined ? undefined : portOf(match[1], match[2], match[3])
  if (port === null) return { error: "invalid" }
  // Rebuild from the parts so a host that only differs by case, a dropped slash or a default port is one row.
  const origin = `${match[1]}://${match[2]}${port === undefined ? "" : `:${port}`}`
  if (existing.includes(origin)) return { error: "duplicate" }
  return { value: origin }
}
