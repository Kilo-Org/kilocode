export * as PagesConfig from "./config"

import path from "node:path"
import type { Config } from "@opencode/schema/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { ManagedPolicy } from "@opencode/core/managed-policy"

export const SERVER = "pages"

/** Where macOS MDM places the managed preferences document, which is outside the system config directory. */
export const MANAGED_PREFERENCES = "/Library/Managed Preferences"

/**
 * Whether the effective `pages` key turns Pages on. Pages sends page text to a service outside Kilo, so opt-in is the
 * consent: only a global or managed document can set `enabled: true`, and a project document can only set `false`
 * (a cloned repository cannot enable it).
 */
export function enabled(entries: readonly Config.Entry[], roots: readonly string[]) {
  const result = entries.reduce<{ value?: boolean; vetoed: boolean }>(
    (state, entry) => {
      if (entry.type !== "document" || !(entry.info instanceof KiloConfigPolicy.Info)) return state
      const value = entry.info.pages?.enabled
      if (value === undefined) return state
      const global = !entry.path || roots.some((root) => inside(root, entry.path!))
      if (global) return { ...state, value }
      return value === false ? { ...state, vetoed: true } : state
    },
    { vetoed: false },
  )
  return result.value === true && !result.vetoed
}

/** Whether the user configured a server named `pages` themselves. Their entry wins and Kilo sign-in is not used for it. */
export function manual(entries: readonly Config.Entry[]) {
  return entries.some((entry) => entry.type === "document" && entry.info.mcp?.servers?.[SERVER] !== undefined)
}

/** Whether `mcp.use` policy denies the server. Checked before anything is minted. */
export function denied(entries: readonly Config.Entry[]) {
  return ManagedPolicy.decision(ManagedPolicy.statements(entries), "mcp.use", SERVER) === "deny"
}

function inside(root: string, file: string) {
  const relative = path.relative(root, file)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
