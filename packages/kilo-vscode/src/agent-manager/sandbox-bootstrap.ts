import type { KiloClient } from "@kilocode/sdk/v2/client"
import { sameDirectory } from "../kilo-provider-utils"

type State = {
  directory: string
  enabled: boolean
  available: boolean
  reason?: string
  version: number
}

function unavailable(state: State) {
  return new Error(state.reason ?? "Sandbox backend is unavailable")
}

function routed(state: State, dir: string) {
  if (!sameDirectory(state.directory, dir)) throw new Error("Sandbox status resolved a different directory")
}

function confirm(state: State, dir: string, desired: boolean) {
  routed(state, dir)
  if (desired && !state.available) throw unavailable(state)
  if (state.enabled !== desired) {
    throw new Error(`Sandbox remained ${state.enabled ? "enabled" : "disabled"} after reconciliation`)
  }
  return state
}

/** Ensure a new session uses the selected sandbox state before its first prompt. */
export async function ensureSandbox(client: KiloClient, sid: string, dir: string, desired: boolean): Promise<State> {
  const sandbox = client.sandbox
  const { data: current } = await sandbox.status({ sessionID: sid, directory: dir }, { throwOnError: true })
  routed(current, dir)
  if (current.enabled === desired) return confirm(current, dir, desired)
  if (!current.available) throw unavailable(current)

  const { data: next } = await sandbox.toggle({ sessionID: sid, directory: dir }, { throwOnError: true })
  return confirm(next, dir, desired)
}
