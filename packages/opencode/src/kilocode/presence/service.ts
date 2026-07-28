import { Auth } from "@/auth"
import { EventServiceClient } from "@/kilocode/event-service/client"
import { KILO_EVENT_SERVICE_URL } from "@kilocode/kilo-gateway"
import * as Log from "@opencode-ai/core/util/log"
import { Context, Effect, Layer } from "effect"
import type { Platform } from "./context"
import {
  attachedUnion,
  desiredContexts,
  dedupe,
  expiredViewerIds,
  nextExpiryDeadline,
  reconcileContexts,
  validateSnapshot,
  visibleUnion,
  type ViewerSnapshot,
  type ViewerState,
} from "./policy"

const log = Log.create({ service: "kilo-viewers" })

function inferPlatform(): Platform | undefined {
  const p = process.env.KILO_PLATFORM
  if (p === "vscode") return "vscode"
  if (p === "cli") return "cli"
  if (p === undefined || p === "") return "cli"
  return undefined
}

function extract(auth: Auth.Info | undefined): { token: string | undefined; identity: string | undefined } {
  const envKey = process.env.KILO_API_KEY?.trim()
  if (auth?.type === "api" && auth.key.length > 0) return { token: auth.key, identity: "api" }
  if (auth?.type === "oauth" && auth.access.length > 0)
    return { token: auth.access, identity: `oauth:${auth.accountId ?? "no-acct"}` }
  if (auth?.type === "wellknown" && auth.token.length > 0) return { token: auth.token, identity: "wellknown" }
  if (envKey) return { token: envKey, identity: "env" }
  return { token: undefined, identity: undefined }
}

function sameArr(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const id of b) if (!set.has(id)) return false
  return true
}

export namespace KiloViewers {
  export interface Interface {
    readonly update: (snapshot: ViewerSnapshot) => Effect.Effect<void>
    readonly invalidateAuth: () => Effect.Effect<void>
  }

  export class Service extends Context.Service<Service, Interface>()("@kilocode/KiloViewers") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const KiloSessions = (yield* Effect.promise(() => import("@/kilo-sessions/kilo-sessions"))).KiloSessions

      const platform = inferPlatform()
      const killSwitch = process.env.KILO_DISABLE_PRESENCE === "1"
      // Same endpoint the server envelope hands KiloClaw; KILO_EVENT_SERVICE_URL
      // is a presence-specific override on top of the gateway's EVENT_SERVICE_URL.
      const url = process.env.KILO_EVENT_SERVICE_URL || KILO_EVENT_SERVICE_URL

      const s = {
        viewers: new Map<string, ViewerState>(),
        prevAttached: [] as string[],
        prevContexts: new Set<string>(),
        identity: undefined as string | undefined,
        token: undefined as string | undefined,
        client: undefined as EventServiceClient | undefined,
        timer: null as ReturnType<typeof setTimeout> | null,
      }

      function presenceEnabled(): boolean {
        return !killSwitch && !!url && !!platform && !!s.token
      }

      function disconnectClient() {
        if (s.client) {
          s.client.disconnect()
          s.client = undefined
        }
        s.prevContexts = new Set()
      }

      function rebuild() {
        log.warn("rebuilding presence connection")
        disconnectClient()
        apply(Date.now())
      }

      function onServerError(err: unknown) {
        const e = err as Record<string, unknown>
        const code = typeof e.code === "string" ? e.code : typeof e.error === "string" ? e.error : ""
        if (code === "too_many_contexts") rebuild()
      }

      function pruneExpired(now: number) {
        const expired = expiredViewerIds([...s.viewers.values()], now)
        for (const id of expired) s.viewers.delete(id)
      }

      function pushAttached() {
        const union = attachedUnion([...s.viewers.values()])
        if (!sameArr(union, s.prevAttached)) {
          s.prevAttached = union
          KiloSessions.setAttachedSessions(union)
        }
      }

      function reconcilePresence() {
        if (!presenceEnabled()) {
          if (s.client) disconnectClient()
          return
        }
        const active = [...s.viewers.values()].some((v) => v.active)
        const { ids, omitted } = visibleUnion([...s.viewers.values()])
        if (omitted > 0) log.warn("omitted visible session contexts", { omitted })
        const desired = desiredContexts(platform as Platform, active, ids)
        if (!s.client) {
          // Don't hold an idle socket open: connect only once there is a context
          // to assert (inactive-only viewers keep attachment but publish nothing).
          if (desired.size === 0) return
          if (!s.token) return
          s.client = new EventServiceClient({
            url: url as string,
            getToken: () => Promise.resolve(s.token!),
            onUnauthorized: () => disconnectClient(),
            onServerError,
          })
          s.client.subscribe([...desired])
          s.prevContexts = desired
          void s.client.connect().catch((err) => log.warn("presence connect failed", { error: String(err) }))
          return
        }
        if (desired.size === 0) {
          disconnectClient()
          return
        }
        const { remove, add } = reconcileContexts(s.prevContexts, desired)
        if (remove.length) s.client.unsubscribe(remove)
        if (add.length) s.client.subscribe(add)
        s.prevContexts = desired
      }

      function apply(now: number) {
        pruneExpired(now)
        pushAttached()
        reconcilePresence()
        rescheduleExpiry(now)
      }

      function rescheduleExpiry(now: number) {
        if (s.timer) {
          clearTimeout(s.timer)
          s.timer = null
        }
        const deadline = nextExpiryDeadline([...s.viewers.values()], now)
        if (deadline === undefined) return
        const delay = Math.max(deadline - now, 0)
        s.timer = setTimeout(() => {
          s.timer = null
          apply(Date.now())
        }, delay)
      }

      const readAuth = auth.get("kilo").pipe(Effect.orElseSucceed((): Auth.Info | undefined => undefined))

      const update = Effect.fn("KiloViewers.update")(function* (snapshot: ViewerSnapshot) {
        const info = yield* readAuth
        const { token, identity } = extract(info)
        if (identity !== s.identity) {
          disconnectClient()
          s.identity = identity
        }
        s.token = token

        const result = validateSnapshot(snapshot)
        if (!result.ok) {
          log.warn("rejected viewer snapshot", { error: result.error.kind })
          return
        }
        s.viewers.set(result.viewer.id, {
          id: result.viewer.id,
          active: result.viewer.active,
          attached: dedupe(result.attached),
          visible: dedupe(result.visible),
          lastSeen: Date.now(),
        })
        apply(Date.now())
      })

      const invalidateAuth = Effect.fn("KiloViewers.invalidateAuth")(function* () {
        disconnectClient()
        s.identity = undefined
        s.token = undefined
        const info = yield* readAuth
        const { token, identity } = extract(info)
        s.token = token
        s.identity = identity
        apply(Date.now())
      })

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (s.timer) {
            clearTimeout(s.timer)
            s.timer = null
          }
          disconnectClient()
          s.viewers.clear()
          KiloSessions.setAttachedSessions([])
        }),
      )

      return Service.of({ update, invalidateAuth })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Auth.defaultLayer))
}
