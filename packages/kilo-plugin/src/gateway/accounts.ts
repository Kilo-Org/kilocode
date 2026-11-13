export * as KiloGatewayAccounts from "./accounts"

import type { KiloAccount } from "@kilocode/gateway-core"

// The active Kilo account of each Location, for the other Kilo plugins in this process that call the Kilo API with
// the same credentials as the chat (codebase indexing embeds through the Gateway). The Gateway plugin registers a
// reader per Location; the value is read when needed, so it follows sign-in, sign-out and team changes.
const readers = new Map<string, () => KiloAccount.Info | undefined>()

export function register(directory: string, read: () => KiloAccount.Info | undefined) {
  readers.set(directory, read)
  return () => {
    if (readers.get(directory) === read) readers.delete(directory)
  }
}

export function get(directory: string) {
  return readers.get(directory)?.()
}

export function registered(directory: string) {
  return readers.has(directory)
}

// A Location's account is undefined for the whole reload window of every credential or organization switch, so a
// consumer that reacts to the raw credential events would see a false sign-out. The Gateway calls `changed` once per
// settled load instead, and listeners then read `get`.
const listeners = new Map<string, Set<() => void>>()

export function subscribe(directory: string, listener: () => void) {
  const set = listeners.get(directory) ?? new Set()
  set.add(listener)
  listeners.set(directory, set)
  return () => {
    set.delete(listener)
    if (set.size === 0 && listeners.get(directory) === set) listeners.delete(directory)
  }
}

export function changed(directory: string) {
  listeners.get(directory)?.forEach((listener) => listener())
}
