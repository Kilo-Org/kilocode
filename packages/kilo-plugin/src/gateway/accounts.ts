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
