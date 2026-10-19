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
  readonly status: () => Effect.Effect<Status>
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
 * Time a successful discovery result stays valid for `status()`.
 *
 * 5 seconds is short enough that a user clicking "Check again" in the dialog
 * always observes a fresh value on a re-check, and long enough to absorb a
 * periodic caller (a re-rendering webview panel, a debounced SSE re-boot path,
 * etc.) that would otherwise drive a Python-heavy management-API query every
 * few hundred milliseconds. Each full discovery issues ~6 HTTPS requests
 * against `127.0.0.1:<port>` and the Anaconda Desktop daemon re-imports
 * pandas / plotly / qt6 for every request, generating heavy disk writes to
 * `runt-nightly\envs\...\__pycache__` and `rattler\cache\pkgs\...\__pycache__`
 * (Issue #37).
 *
 * `status()` honours the cache; `sync()` always bypasses it — a sync that
 * just succeeded must be visible immediately, otherwise the user could
 * "connect" but still see "not ready" in the dialog.
 */
const STATUS_CACHE_TTL = Duration.seconds(5)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const cache = yield* ModelCache.Service
    const discovery = yield* Discovery.Service
    const instances = yield* InstanceStore.Service
    const platform = yield* DesktopPlatform.Service

    // Single-flight + short-TTL cache for `status()`. Issue #37: without these
    // guards, a periodic caller of `status()` (e.g. a webview that polls on a
    // tight cadence) can fan out to `discovery.discover()` continuously; each
    // call hits the Anaconda Desktop Python management API multiple times and
    // re-imports heavy Python packages, causing runtimed-nightly.exe to
    // consume ~50% CPU and write ~20-30 MB/s to __pycache__ while the user is
    // idle.
    //
    // - `cacheRef` / `cacheExpiresAt` are the latest successful `discover()`
    //   result and the wall-clock instant it goes stale.
    // - `flight` is a single-permit semaphore that serialises concurrent
    //   `discover()` calls so two callers cannot both fan out to the heavy
    //   path at the same instant.
    const cacheRef = yield* Ref.make<Discovery.DiscoveryResult | undefined>(undefined)
    const cacheExpiresAt = yield* Ref.make<number>(0)
    const flight = Semaphore.makeUnsafe(1)

    // Read the cache, otherwise run a single `discover()` and remember the
    // result for `STATUS_CACHE_TTL`. Concurrent callers coalesce via `flight`.
    const cachedStatus = Effect.fnUntraced(function* () {
      const now = yield* Clock.currentTimeMillis
      const expires = yield* Ref.get(cacheExpiresAt)
      const cached = yield* Ref.get(cacheRef)
      if (cached !== undefined && expires > now) return cached

      // Serialise: at most one `discover()` in flight at a time. Concurrent
      // callers wait on `flight` and read the same cached result below.
      const result = yield* flight.withPermits(1)(
        Effect.gen(function* () {
          // Re-check inside the critical section; another caller may have
          // populated the cache while we were waiting for the permit.
          const nowLocked = yield* Clock.currentTimeMillis
          const expiresLocked = yield* Ref.get(cacheExpiresAt)
          const stillCached = yield* Ref.get(cacheRef)
          if (stillCached !== undefined && expiresLocked > nowLocked) return stillCached

          const fresh = yield* discovery.discover()
          yield* Ref.set(cacheRef, fresh)
          yield* Ref.set(cacheExpiresAt, nowLocked + Duration.toMillis(STATUS_CACHE_TTL))
          return fresh
        }),
      )
      return result
    })

    const invalidateCache = Effect.fnUntraced(function* () {
      yield* Ref.set(cacheRef, undefined)
      yield* Ref.set(cacheExpiresAt, 0)
    })

    const status = Effect.fn("AnacondaDesktop.status")(function* () {
      const found = yield* cachedStatus()
      return found.status
    })

    const open = Effect.fn("AnacondaDesktop.open")(function* () {
      yield* platform.open()
      return true as const
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
        .pipe(Effect.ensuring(invalidateCache()))
    })

    return Service.of({ status, open, sync })
  }),
)

const platform = DesktopPlatform.layer
const discovery = Discovery.layer.pipe(Layer.provide(platform))

export const liveLayer = layer.pipe(Layer.provide(discovery), Layer.provide(platform))
