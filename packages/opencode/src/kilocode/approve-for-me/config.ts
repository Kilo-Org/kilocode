import type { Config } from "@/config/config"

/**
 * Approve-for-me (Gatekeeper) configuration.
 *
 * This is the entry point iteration only: the mode exists so the VS Code
 * composer and CLI can agree on a mode name, but nothing reads
 * "review"/"auto" to change approval behavior yet. See issue #7684.
 *
 * Types derive from the `approve_for_me` field on `Config.Info` (the single
 * source of truth in packages/core/src/v1/config/config.ts) instead of
 * redeclaring the schema, so the two cannot drift out of sync.
 */
export namespace ApproveForMeConfig {
  export type Info = NonNullable<Config.Info["approve_for_me"]>
  export type Mode = NonNullable<Info["mode"]>

  export function resolve(config: { approve_for_me?: Info }): { mode: Mode } {
    return { mode: config.approve_for_me?.mode ?? "off" }
  }
}
