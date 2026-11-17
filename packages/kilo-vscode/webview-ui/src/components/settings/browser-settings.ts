// The Browser section's view model: the permission table and the origin field, kept apart from the JSX so the mapping
// from the rules the host stores is testable. A rule names one class of one origin (`<class>:<origin>`); a class
// without a rule asks, which is also what the CLI does for an origin the defaults do not cover.
import type { BrowserSettingsState } from "../../../../src/protocol"

export type Effect = "allow" | "ask" | "deny"
export type Grant = "read" | "act" | "navigate"
export type Rule = BrowserSettingsState["rules"][number]

export const GRANTS: readonly Grant[] = ["read", "act", "navigate"]
export const EFFECTS: readonly Effect[] = ["allow", "ask", "deny"]

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
 * The permission table: one row per origin in the order the rules first name it, with every class the origin has no
 * rule for asking. The allow-all catch-all is the separate toggle, not a row.
 */
export function sites(rules: Rule[]): Site[] {
  const rows = new Map<string, Site>()
  for (const rule of rules) {
    if (rule.action !== "browser" || rule.resource === "*") continue
    const parts = parse(rule.resource)
    if (!parts) continue
    const row = rows.get(parts.origin) ?? { origin: parts.origin, read: "ask", act: "ask", navigate: "ask" }
    row[parts.grant] = rule.effect
    rows.set(parts.origin, row)
  }
  return [...rows.values()]
}

/**
 * The origin the Add field turns into rules, or why it cannot be one. An origin is a scheme, a host and an optional
 * port: a path, a query and a fragment would never match the protocol's origin, so they are refused here.
 */
export function origin(
  input: string,
  existing: readonly string[] = [],
): { value: string } | { error: "empty" | "invalid" | "duplicate" } {
  const value = input.trim().replace(/\/$/, "").toLowerCase()
  if (value.length === 0) return { error: "empty" }
  const match = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9*](?:[a-z0-9.*-]*[a-z0-9*])?)(?::(\d{1,5}|\*))?$/.exec(value)
  if (!match) return { error: "invalid" }
  // Rebuild from the parts so a host that only differs by case or a dropped slash is one row.
  const origin = `${match[1]}://${match[2]}${match[3] ? `:${match[3]}` : ""}`
  if (existing.includes(origin)) return { error: "duplicate" }
  return { value: origin }
}
