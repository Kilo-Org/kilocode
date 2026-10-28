import type { HostedSessionID, HostedWorkspaceID, Provider } from "@/kilocode/session-hosting/types"
import { ascending } from "@opencode-ai/schema/identifier"
import { Schema } from "effect"

/**
 * Opaque local attachment identity.
 *
 * The `wrk` prefix is load-bearing: the local workspace selector is decoded with
 * the existing `WorkspaceV2.ID` schema, which only requires that prefix. A
 * `wrk_att_` id is therefore valid there, while it can never collide with a real
 * workspace id, because those are `wrk_` followed by alphanumerics only.
 */
export const PREFIX = "wrk_att_"

/** Local inactivity window. Deliberately longer than the provider descriptor. */
export const LEASE_MS = 10 * 60_000

const ENDED_LIMIT = 256
const LIVE_LIMIT = 256

export const ID = Schema.String.check(Schema.isPattern(/^wrk_att_[0-9A-Za-z]{26}$/))
  .pipe(Schema.brand("SessionHostAttachmentID"))
  .annotate({ identifier: "SessionHostAttachmentID" })
export type ID = typeof ID.Type

export function isID(value: string): value is ID {
  return /^wrk_att_[0-9A-Za-z]{26}$/.test(value)
}

export function createID(): ID {
  return ID.make(`${PREFIX}${ascending()}`)
}

export interface Entry {
  readonly id: ID
  readonly provider: Provider
  readonly session: HostedSessionID
  /** Workspace membership used to invalidate attachments on workspace deletion. */
  readonly workspace?: HostedWorkspaceID
  readonly organizationID?: string
  /** Provider-declared validity. A lapsed descriptor is re-attached before use. */
  expiresAt: number
  /** Local inactivity lease. */
  leaseExpiresAt: number
}

export type Lookup =
  | { readonly kind: "found"; readonly entry: Entry }
  | { readonly kind: "unknown" }
  | { readonly kind: "expired" }
  | { readonly kind: "disposed" }

export interface Mint {
  readonly provider: Provider
  readonly session: HostedSessionID
  readonly workspace?: HostedWorkspaceID
  readonly organizationID?: string
  readonly expiresAt: number
}

export interface Options {
  readonly now?: () => number
}

/**
 * In-memory attachment registry. Attachments never persist: a server restart
 * invalidates them and every lookup then fails explicitly instead of falling
 * back to local execution.
 */
export function create(options: Options = {}) {
  const now = options.now ?? Date.now
  const live = new Map<string, Entry>()
  const ended = new Map<string, "expired" | "disposed">()

  const end = (id: string, reason: "expired" | "disposed") => {
    live.delete(id)
    ended.delete(id)
    ended.set(id, reason)
    while (ended.size > ENDED_LIMIT) {
      const oldest = ended.keys().next().value
      if (oldest === undefined) break
      ended.delete(oldest)
    }
  }

  const mint = (input: Mint): Entry => {
    const entry: Entry = {
      id: createID(),
      provider: input.provider,
      session: input.session,
      ...(input.workspace ? { workspace: input.workspace } : {}),
      ...(input.organizationID ? { organizationID: input.organizationID } : {}),
      expiresAt: input.expiresAt,
      leaseExpiresAt: now() + LEASE_MS,
    }
    live.set(entry.id, entry)
    while (live.size > LIVE_LIMIT) {
      const oldest = live.keys().next().value
      if (oldest === undefined) break
      end(oldest, "expired")
    }
    ended.delete(entry.id)
    return entry
  }

  const lookup = (id: string): Lookup => {
    const entry = live.get(id)
    if (entry) {
      if (entry.leaseExpiresAt > now()) return { kind: "found", entry }
      end(id, "expired")
      return { kind: "expired" }
    }
    const reason = ended.get(id)
    if (reason === "expired") return { kind: "expired" }
    if (reason === "disposed") return { kind: "disposed" }
    return { kind: "unknown" }
  }

  const same = (entry: Entry, session: HostedSessionID) =>
    entry.session.providerID === session.providerID && entry.session.sessionID === session.sessionID

  const count = (session: HostedSessionID) => {
    const current = now()
    for (const entry of live.values()) {
      if (entry.leaseExpiresAt <= current) end(entry.id, "expired")
    }
    return Array.from(live.values()).filter((entry) => same(entry, session)).length
  }

  const renew = (entry: Entry, input: { expiresAt: number }) => {
    if (live.get(entry.id) !== entry) return
    entry.expiresAt = input.expiresAt
    entry.leaseExpiresAt = now() + LEASE_MS
    live.delete(entry.id)
    live.set(entry.id, entry)
  }

  const dispose = (id: string) => {
    if (!live.has(id)) return false
    end(id, "disposed")
    return true
  }

  /**
   * Disposes every attachment bound to one composite native session identity.
   * Stale provider sessions invalidate all of their attachments at once, while
   * other sessions and providers keep theirs. Repeated disposal is safe.
   */
  const disposeSession = (session: HostedSessionID) => {
    for (const entry of Array.from(live.values())) {
      if (same(entry, session)) end(entry.id, "disposed")
    }
  }

  /**
   * Disposes every attachment bound to one workspace. Workspace deletion or a
   * missing workspace invalidates all of its root sessions at once, while other
   * workspaces and providers keep theirs.
   */
  const disposeWorkspace = (workspace: HostedWorkspaceID) => {
    for (const entry of Array.from(live.values())) {
      if (
        entry.workspace?.providerID === workspace.providerID &&
        entry.workspace.workspaceID === workspace.workspaceID
      ) {
        end(entry.id, "disposed")
      }
    }
  }

  const clear = () => {
    live.clear()
    ended.clear()
  }

  return { mint, lookup, count, renew, dispose, disposeSession, disposeWorkspace, clear }
}

export type Store = ReturnType<typeof create>

/** Process-wide store used by the local API and the routing hook. */
export const store: Store = create()
