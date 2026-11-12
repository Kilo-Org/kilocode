export * as PagesConfig from "./config"

import type { Config } from "@opencode/schema/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { ManagedPolicy } from "@opencode/core/managed-policy"
import { PagesToken } from "./token"

export const SERVER = "pages"

/** The environment variable that picks the Pages deployment. It wins over the `pages.destination` setting. */
export const DESTINATION_ENV = "KILO_PAGES_DESTINATION"

/** Whether the effective `pages` key turns Pages on. */
export function enabled(entries: readonly Config.Entry[]) {
  return KiloConfigPolicy.pagesConfig(entries).enabled === true
}

/**
 * The deployment Pages talks to: the environment variable, then the effective `pages.destination`, then the default.
 * An unrecognized environment value is ignored rather than guessed at.
 */
export function destination(entries: readonly Config.Entry[], env: string | undefined = process.env[DESTINATION_ENV]) {
  const configured = KiloConfigPolicy.pagesConfig(entries).destination
  return (
    PagesToken.DEPLOYMENTS.find((deployment) => deployment.resource === env?.trim()) ??
    PagesToken.DEPLOYMENTS.find((deployment) => deployment.resource === configured) ??
    PagesToken.DEFAULT
  )
}

/** Whether the user configured a server named `pages` themselves. Their entry wins and Kilo sign-in is not used for it. */
export function manual(entries: readonly Config.Entry[]) {
  return entries.some((entry) => entry.type === "document" && entry.info.mcp?.servers?.[SERVER] !== undefined)
}

/** Whether `mcp.use` policy denies the server. Checked before anything is minted. */
export function denied(entries: readonly Config.Entry[]) {
  return ManagedPolicy.decision(ManagedPolicy.statements(entries), "mcp.use", SERVER) === "deny"
}
