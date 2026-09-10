/**
 * Kilo-owned viewer presence registry, ported from the pinned baseline
 * (`packages/opencode/src/kilocode/presence/service.ts` at d99662338e).
 *
 * Owns the per-viewer registry: policy-validated viewer snapshots with a lease
 * TTL, aggregated attached/visible unions, and — when the Kilo event-service
 * relay is configured — forwarding of the aggregated presence to the Kilo cloud
 * through the relay client. The relay credential is supplied per viewed call by
 * the caller (the Location-scoped gateway account effect), so this module stays
 * free of VS Code, Core, Server, and gateway imports.
 */

import { Effect } from "effect"
import { KILO_EVENT_SERVICE_URL, type GatewayExtension } from "@kilocode/gateway"
import { KiloPresenceRpc } from "@opencode-ai/schema/kilocode/presence"
import { type Platform } from "./presence-context"
import {
  attachedUnion,
  desiredContexts,
  expiredViewerIds,
  nextExpiryDeadline,
  reconcileContexts,
  validateSnapshot,
  visibleUnion,
  type ViewerSnapshot,
} from "./presence-policy"
import { EventServiceClient } from "./presence-event-service-client"

export interface KiloViewersDeps {
  /** Optional local consumer of the attached union (the pinned KiloSessions seam). */
  setAttachedSessions?(ids: readonly string[]): void
  /** Injectable clock (defaults to Date.now) so lease expiry is testable. */
  now?(): number
  /** Explicit relay override; tests must pass a loopback double and never the default. */
  relayUrl?: string
  log?(message: string, meta?: unknown): void
}

/** The relay credential a viewer call contributes for the shared connection. */
export interface PresenceAuth {
  token: string
}

function inferPlatform(): Platform {
  const platform = process.env.KILO_PLATFORM
  if (platform === "vscode") return "vscode"
  if (platform === undefined || platform === "") return "cli"
  return "cli"
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function sameArr(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const id of b) if (!set.has(id)) return false
  return true
}

interface RegisteredViewer {
  id: string
  active: boolean
  attached: string[]
  visible: string[]
  lastSeen: number
}

export class KiloViewers {
  private readonly viewers = new Map<string, RegisteredViewer>()
  private prevAttached: string[] = []
  private prevContexts = new Set<string>()
  private identity: string | undefined
  private token: string | undefined
  private client: EventServiceClient | undefined
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: KiloViewersDeps) {}

  private log(message: string, meta?: unknown): void {
    this.deps.log?.(message, meta)
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  // Same endpoint the server envelope hands KiloClaw. Tests must pass an
  // explicit loopback relay override through deps.relayUrl and never contact
  // this default.
  private relayUrl(): string {
    return this.deps.relayUrl ?? KILO_EVENT_SERVICE_URL
  }

  private presenceEnabled(): boolean {
    return !process.env.KILO_DISABLE_PRESENCE && !!this.token
  }

  private disconnectClient() {
    if (this.client) {
      this.client.disconnect()
      this.client = undefined
    }
    this.prevContexts = new Set()
  }

  private onServerError(error: unknown) {
    const record = error as { code?: unknown; error?: unknown }
    const code = typeof record?.code === "string" ? record.code : typeof record?.error === "string" ? record.error : ""
    if (code === "too_many_contexts") {
      this.log?.("rebuilding presence connection")
      this.disconnectClient()
      this.apply(this.now())
    }
  }

  private pruneExpired(now: number) {
    for (const id of expiredViewerIds([...this.viewers.values()], now)) this.viewers.delete(id)
  }

  private pushAttached() {
    const union = attachedUnion([...this.viewers.values()])
    if (!sameArr(union, this.prevAttached)) {
      this.prevAttached = union
      this.deps.setAttachedSessions?.(union)
    }
  }

  private reconcilePresence() {
    if (!this.presenceEnabled()) {
      if (this.client) this.disconnectClient()
      return
    }
    const platform = inferPlatform()
    const active = [...this.viewers.values()].some((viewer) => viewer.active)
    const { ids, omitted } = visibleUnion([...this.viewers.values()])
    if (omitted > 0) this.log?.("omitted visible session contexts", { omitted })
    const desired = desiredContexts(platform, active, ids)
    if (!this.client) {
      // Don't hold an idle socket open: connect only once there is a context
      // to assert (inactive-only viewers keep attachment but publish nothing).
      if (desired.size === 0) return
      if (!this.token) return
      this.client = new EventServiceClient({
        url: this.relayUrl(),
        getToken: () => Promise.resolve(this.token!),
        onUnauthorized: () => this.disconnectClient(),
        onServerError: (error) => this.onServerError(error),
      })
      this.client.subscribe([...desired])
      this.prevContexts = desired
      void this.client.connect().catch((error) => this.log?.("presence connect failed", { error: String(error) }))
      return
    }
    if (desired.size === 0) {
      this.disconnectClient()
      return
    }
    const { remove, add } = reconcileContexts(this.prevContexts, desired)
    if (remove.length) this.client.unsubscribe(remove)
    if (add.length) this.client.subscribe(add)
    this.prevContexts = desired
  }

  private apply(now: number) {
    this.pruneExpired(now)
    this.pushAttached()
    this.reconcilePresence()
    this.rescheduleExpiry(now)
  }

  private rescheduleExpiry(now: number) {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const deadline = nextExpiryDeadline([...this.viewers.values()], now)
    if (deadline === undefined) return
    const delay = Math.max(deadline - now, 0)
    this.timer = setTimeout(() => {
      this.timer = null
      this.apply(this.now())
    }, delay)
  }

  /**
   * Record a viewer snapshot. `auth` is the credential resolved by the CALLER
   * (the Location-scoped gateway account at viewed time): it becomes the relay
   * credential, and a token change reconnects the shared relay connection.
   */
  async update(snapshot: ViewerSnapshot, auth?: PresenceAuth): Promise<void> {
    const token = auth?.token || undefined
    if (token !== this.identity) {
      this.disconnectClient()
      this.identity = token
    }
    this.token = token

    const result = validateSnapshot(snapshot)
    if (!result.ok) {
      this.log?.("rejected viewer snapshot", { error: result.error.kind })
      return
    }
    this.viewers.set(result.viewer.id, {
      id: result.viewer.id,
      active: result.viewer.active,
      attached: result.attached,
      visible: result.visible,
      lastSeen: this.now(),
    })
    this.apply(this.now())
  }

  /**
   * Drop the relay credential without re-resolving it (a Location deactivation
   * clears its claim; the next viewed call from a live Location re-supplies it).
   */
  async clearAuth(): Promise<void> {
    if (this.token === undefined && this.identity === undefined) return
    this.disconnectClient()
    this.identity = undefined
    this.token = undefined
    this.apply(this.now())
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.disconnectClient()
    this.viewers.clear()
    this.deps.setAttachedSessions?.([])
  }
}

export interface PresenceRuntimeOptions {
  now?(): number
  relayUrl?: string
  setAttachedSessions?(ids: readonly string[]): void
  log?(message: string, meta?: unknown): void
}

export interface PresenceRuntime {
  /** GatewayExtension: registers the KiloPresenceRpc route for each Location activation. */
  readonly presence: GatewayExtension
  /** Stop the relay and drop the host-global registry (host shutdown). */
  readonly dispose: () => void
}

/**
 * Host-global presence runtime factory for the interactive server: create it
 * once at composition so the registry survives Location activations. Each
 * Location activation registers the KiloPresenceRpc route scoped to that
 * activation and resolves the account per actual viewed call — the relay
 * credential follows the latest viewed call, and a Location deactivation clears
 * its claim without dropping the registry.
 */
export function createPresenceRuntime(options: PresenceRuntimeOptions = {}): PresenceRuntime {
  const viewers = new KiloViewers({
    now: options.now,
    relayUrl: options.relayUrl,
    setAttachedSessions: options.setAttachedSessions,
    log: options.log ?? ((text, meta) => console.warn(`[Kilo presence] ${text}`, meta ?? "")),
  })
  return {
    presence: (ctx, account) =>
      Effect.gen(function* () {
        yield* ctx.rpc.register(KiloPresenceRpc.Definition, {
          viewed: (input: ViewerSnapshot, call) =>
            Effect.gen(function* () {
              // The account is this Location's authoritative resolver, re-run per
              // actual viewed call so credential switches reconnect the relay.
              const resolved = yield* account.pipe(
                Effect.mapError((failure: unknown) => call.error("kilocode.presence", message(failure))),
              )
              yield* Effect.promise(() => viewers.update(input, { token: resolved.token })).pipe(
                Effect.mapError((failure: unknown) => call.error("kilocode.presence", message(failure))),
              )
              return true
            }),
        })
        // Location deactivation clears this activation's relay claim; the
        // registry itself stays host-global.
        yield* Effect.addFinalizer(() => Effect.promise(() => viewers.clearAuth()))
      }),
    dispose: () => viewers.dispose(),
  }
}
