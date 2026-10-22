import { Auth } from "@/auth"
import { invalidateAfterProviderAuthChange } from "@/kilocode/server/provider-auth-lifecycle"
import { InstanceStore } from "@/project/instance-store"
import { ModelCache } from "@/provider/model-cache"
import { Context, Effect, Layer, Redacted } from "effect"
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

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const cache = yield* ModelCache.Service
    const discovery = yield* Discovery.Service
    const instances = yield* InstanceStore.Service
    const platform = yield* DesktopPlatform.Service

    const status = Effect.fn("AnacondaDesktop.status")(function* () {
      return (yield* discovery.discover()).status
    })

    const open = Effect.fn("AnacondaDesktop.open")(function* () {
      yield* platform.open()
      return true as const
    })

    const sync = Effect.fn("AnacondaDesktop.sync")(function* (acknowledge = false) {
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
      const stored = yield* auth.get(PROVIDER_ID).pipe(Effect.mapError(() => new SyncError({ operation: "store" })))
      if (stored?.type === "api" && stored.key === key && same(stored.metadata, metadata)) return found.status
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
    })

    return Service.of({ status, open, sync })
  }),
)

const platform = DesktopPlatform.layer
const discovery = Discovery.layer.pipe(Layer.provide(platform))

export const liveLayer = layer.pipe(Layer.provide(discovery), Layer.provide(platform))
