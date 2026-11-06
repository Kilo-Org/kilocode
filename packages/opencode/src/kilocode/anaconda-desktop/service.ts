import { Auth } from "@/auth"
import { invalidateAfterProviderAuthChange } from "@/kilocode/server/provider-auth-lifecycle"
import { InstanceStore } from "@/project/instance-store"
import { ModelCache } from "@/provider/model-cache"
import { Clock, Context, Duration, Effect, Layer, Redacted, Ref, Semaphore } from "effect"
import * as Discovery from "./discovery"
import * as DesktopPlatform from "./platform"
import {
  encodeMetadata,
  NotReadyError,
  PROVIDER_ID,
  SyncError,
  ToolAcknowledgementError,
  type PlatformError,
  type ReadyStatus,
  type Status,
} from "./domain"

export interface Interface {
  /** `refresh` bypasses the TTL cache so a user-driven re-check always observes the machine as it is now. */
  readonly status: (refresh?: boolean) => Effect.Effect<Status>
  readonly open: () => Effect.Effect<true, PlatformError>
  readonly sync: (
    acknowledge?: boolean,
  ) => Effect.Effect<ReadyStatus, NotReadyError | SyncError | ToolAcknowledgementError>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/AnacondaDesktop") {}

function same(left: Record<string, string> | undefined, right: Record<string, string>) {
  if (!left) return false
  const keys = Object.keys(right)
  if (Object.keys(left).length !== keys.length) return false
  return keys.every((key) => left[key] === right[key])
}

/**
 * How long a discovery result stays valid for a throttled `status()` call.
 *
 * A full discovery issues ~6 sequential HTTPS requests against
 * `127.0.0.1:<port>` and the Anaconda Desktop daemon re-imports pandas /
 * plotly / qt6 for each one, writing heavily to
 * `runt-nightly\envs\...\__pycache__` and `rattler\cache\pkgs\...\__pycache__`
 * (Issue #37). A periodic caller (a re-rendering webview panel, a debounced
 * SSE re-boot path, ...) must therefore not be able to reach the daemon on
 * every call.
 *
 * 5 seconds is long enough to absorb such a caller and short enough that the
 * next throttled call still tracks the machine. User-driven actions do not rely
 * on it: `status(true)` and `sync()` bypass the cache, and `open()` / `sync()`
 * invalidate it, so "check again" is never answered from a stale snapshot.
 */
const STATUS_CACHE_TTL = Duration.seconds(5)

interface Cached {
  readonly result: Discovery.DiscoveryResult
  readonly expires: number
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const cache = yield* ModelCache.Service
    const discovery = yield* Discovery.Service
    const instances = yield* InstanceStore.Service
    const platform = yield* DesktopPlatform.Service

    // Issue #37: a periodic caller of `status()` must not be able to fan out to
    // `discovery.discover()` continuously; each call hits the Anaconda Desktop
    // Python management API multiple times and re-imports heavy Python
    // packages, driving runtimed-nightly.exe to ~50% CPU and 20-30 MB/s of
    // `__pycache__` writes while the user is idle.
    //
    // - `memo` holds the latest discovery result plus the wall-clock instant it
    //   goes stale. The instant is read *after* `discover()` returns, so a slow
    //   discovery cannot publish a value that is already expired.
    // - `flight` is a single-permit semaphore that serialises discovery so two
    //   callers never reach the heavy path at the same instant. Waiters re-read
    //   the cache inside the permit and reuse the leader's result.
    const memo = yield* Ref.make<Cached | undefined>(undefined)
    const flight = Semaphore.makeUnsafe(1)

    const cached = Effect.fnUntraced(function* () {
      const entry = yield* Ref.get(memo)
      const now = yield* Clock.currentTimeMillis
      if (entry !== undefined && entry.expires > now) return entry.result
    })

    const invalidate = Effect.fnUntraced(function* () {
      yield* Ref.set(memo, undefined)
    })

    const resolve = Effect.fnUntraced(function* (refresh: boolean) {
      if (!refresh) {
        const hit = yield* cached()
        if (hit !== undefined) return hit
      }

      return yield* flight.withPermits(1)(
        Effect.gen(function* () {
          // Re-check inside the critical section; another caller may have
          // published the result while we were waiting for the permit.
          if (!refresh) {
            const hit = yield* cached()
            if (hit !== undefined) return hit
          }

          const result = yield* discovery.discover()
          const now = yield* Clock.currentTimeMillis
          yield* Ref.set(memo, { result, expires: now + Duration.toMillis(STATUS_CACHE_TTL) })
          return result
        }),
      )
    })

    const status = Effect.fn("AnacondaDesktop.status")(function* (refresh = false) {
      return (yield* resolve(refresh)).status
    })

    const open = Effect.fn("AnacondaDesktop.open")(function* () {
      // Opening Desktop changes what a later check finds, so drop the cache
      // instead of letting the next `status()` answer from the pre-open
      // snapshot.
      return yield* platform.open().pipe(Effect.as(true as const), Effect.ensuring(invalidate()))
    })

    const sync = Effect.fn("AnacondaDesktop.sync")(function* (acknowledge = false) {
      // `sync()` must always observe the latest state and must invalidate the
      // status cache so the next `status()` reflects any side effect. We still
      // take the same single-flight permit so a `status()` racing a `sync()`
      // does not double-fan-out to the Python management API. `ensuring`
      // guarantees the cache is invalidated whether sync succeeds or fails
      // (including `NotReadyError` / `ToolAcknowledgementError` short-circuits).
      return yield* flight
        .withPermits(1)(
          Effect.gen(function* () {
            const found = yield* discovery.discover()
            if (found.status.type !== "ready" || !found.connection) {
              return yield* new NotReadyError({ status: found.status })
            }
            if (found.status.toolcall !== "supported" && !acknowledge) {
              return yield* new ToolAcknowledgementError({ status: found.status })
            }

            const metadata = encodeMetadata(found.connection.metadata)
            if (!metadata) return yield* new SyncError({ operation: "encode" })
            const key = Redacted.value(found.connection.key)
            const stored = yield* auth
              .get(PROVIDER_ID)
              .pipe(Effect.mapError(() => new SyncError({ operation: "store" })))
            if (stored?.type === "api" && stored.key === key && same(stored.metadata, metadata)) {
              return found.status
            }
            yield* auth
              .set(
                PROVIDER_ID,
                new Auth.Api({
                  type: "api",
                  key,
                  metadata,
                }),
              )
              .pipe(Effect.mapError(() => new SyncError({ operation: "store" })))
            yield* invalidateAfterProviderAuthChange(PROVIDER_ID).pipe(
              Effect.provideService(ModelCache.Service, cache),
              Effect.provideService(InstanceStore.Service, instances),
            )
            return found.status
          }),
        )
        .pipe(Effect.ensuring(invalidate()))
    })

    return Service.of({ status, open, sync })
  }),
)

const platform = DesktopPlatform.layer
const discovery = Discovery.layer.pipe(Layer.provide(platform))

export const liveLayer = layer.pipe(Layer.provide(discovery), Layer.provide(platform))
