export * as BoardEnabled from "./enabled"

import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import type { Config } from "@opencode/schema/config"

/**
 * The effective Kilo Swarm state. The board is on by default and turns off only on an explicit opt-out:
 * `shared_agent_board: false` in config, or `KILO_EXPERIMENTAL_SHARED_AGENT_BOARD` set to a false boolean. Either
 * opt-out wins over an explicit enable.
 */
export function resolve(input: { config?: boolean; flag?: boolean }) {
  if (input.config === false) return false
  if (input.flag === false) return false
  return true
}

/** The `shared_agent_board` key of the effective entries: the last document that sets it wins. */
export function config(entries: readonly Config.Entry[]) {
  return entries.reduce<boolean | undefined>(
    (value, entry) =>
      entry.type === "document" &&
      entry.info instanceof KiloConfigPolicy.Info &&
      entry.info.shared_agent_board !== undefined
        ? entry.info.shared_agent_board
        : value,
    undefined,
  )
}

export function flag(value = process.env.KILO_EXPERIMENTAL_SHARED_AGENT_BOARD) {
  const normalized = value?.trim().toLowerCase()
  if (normalized === undefined) return undefined
  if (["true", "yes", "on", "1", "y"].includes(normalized)) return true
  if (["false", "no", "off", "0", "n"].includes(normalized)) return false
  return undefined
}

export function on(entries: readonly Config.Entry[]) {
  return resolve({ config: config(entries), flag: flag() })
}
