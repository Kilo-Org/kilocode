export * as PagesConfig from "./config"

import type { Config } from "@opencode/schema/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { ManagedPolicy } from "@opencode/core/managed-policy"

export const SERVER = "pages"

/** Whether the effective `pages` key turns Pages on: like other settings, the last document that sets it wins. */
export function enabled(entries: readonly Config.Entry[]) {
  return entries.reduce<boolean | undefined>(
    (value, entry) =>
      entry.type === "document" && entry.info instanceof KiloConfigPolicy.Info && entry.info.pages?.enabled !== undefined
        ? entry.info.pages.enabled
        : value,
    undefined,
  ) === true
}

/** Whether the user configured a server named `pages` themselves. Their entry wins and Kilo sign-in is not used for it. */
export function manual(entries: readonly Config.Entry[]) {
  return entries.some((entry) => entry.type === "document" && entry.info.mcp?.servers?.[SERVER] !== undefined)
}

/** Whether `mcp.use` policy denies the server. Checked before anything is minted. */
export function denied(entries: readonly Config.Entry[]) {
  return ManagedPolicy.decision(ManagedPolicy.statements(entries), "mcp.use", SERVER) === "deny"
}
