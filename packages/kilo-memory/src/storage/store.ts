import { MemoryAudit } from "./audit"
import { MemoryFs } from "./fs"
import { MemorySessions } from "./sessions"
import { MemorySources } from "./sources"
import { MemoryState } from "./state"

/** Low-level raw-root APIs. Callers must pass a project-owned root from MemoryPaths.root(ctx). */
export namespace MemoryFiles {
  export type Decision = MemoryAudit.Decision
  export type InventoryItem = MemorySources.InventoryItem
  export type Inventory = MemorySources.Inventory

  export const exists = MemoryFs.exists
  export const queue = MemoryFs.queue

  export const readState = MemoryState.readState
  export const writeState = MemoryState.writeState
  export const inventoryKey = MemorySources.inventoryKey
  export const deriveInventory = MemorySources.deriveInventory
  export const writeManifest = MemoryState.writeManifest

  export const append = MemoryAudit.append
  export const decide = MemoryAudit.decide
  export const readDecisions = MemoryAudit.readDecisions
  export const readChanges = MemoryAudit.readChanges

  export const indexExpired = MemoryState.indexExpired
  export const scaffold = MemoryState.scaffold
  export const owned = MemoryState.owned

  export const writeSession = MemorySessions.writeSession
  export const readSession = MemorySessions.readSession
  export const pruneSessions = MemorySessions.pruneSessions
  export const recentSessions = MemorySessions.recentSessions

  export const readSource = MemorySources.readSource
  export const writeSource = MemorySources.writeSource

  export const readIndex = MemoryState.readIndex
  export const writeIndex = MemoryState.writeIndex

  export const show = MemoryState.show
  export const purge = MemoryState.purge
}
