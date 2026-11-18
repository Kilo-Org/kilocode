export * as GatewayCatalog from "./catalog.js"

import { KiloDefaults, KiloServer, type KiloModels } from "@kilocode/gateway-core"
import { Effect, type Result } from "effect"
import { createHash } from "node:crypto"

export interface Snapshot {
  readonly models: readonly KiloModels.Model[]
  readonly imageModels?: readonly KiloModels.Model[]
  readonly defaultModelID?: string
}

export interface View extends Snapshot {
  readonly imageModels: readonly KiloModels.Model[]
  readonly failed: boolean
  readonly failure?: KiloModels.Failure
  readonly anonymous: boolean
}

interface Snapshots {
  read(key: string): Effect.Effect<Snapshot | undefined>
  save(key: string, snapshot: Snapshot): Effect.Effect<void>
}

// Decide what to publish after a scoped fetch. The caller owns epoch checks, publication and retry timing.
export const settle = Effect.fnUntraced(function* (
  scope: { base: string; token?: string; organizationID: string | null },
  fetched: Result.Result<KiloModels.Result, KiloModels.Failure>,
  defaultModelID: string | undefined,
  snapshots: Snapshots,
): Effect.fn.Return<{ view: View; retry?: KiloModels.Failure }> {
  if (fetched._tag === "Success") {
    const result = fetched.success
    const models = result.models
    const snapshot = {
      models,
      imageModels: result.imageModels,
      defaultModelID: models.some((model) => model.id === defaultModelID)
        ? defaultModelID
        : scope.organizationID
          ? models[0]?.id
          : (defaultModelID ?? KiloDefaults.firstSorted(models.map((model) => model.id))),
    }
    if (!scope.organizationID && models.length > 0) {
      // A Personal 401 can return the public catalog. Cache it as anonymous, not under the rejected token.
      yield* snapshots.save(snapshotKey(scope.base, result.anonymous ? undefined : scope.token), snapshot)
    }
    return {
      view: { ...snapshot, failed: false, anonymous: result.anonymous },
      retry: models.length === 0 ? { kind: "network" } : undefined,
    }
  }

  // Team failures never reuse a snapshot, even if a Personal catalog was fetched with the same credential.
  const stored = scope.organizationID ? undefined : yield* snapshots.read(snapshotKey(scope.base, scope.token))
  const anonymous = !scope.organizationID && scope.token === undefined
  return {
    view: stored
      ? {
          models: stored.models,
          imageModels: stored.imageModels ?? [],
          // The stored default belongs to the stored models; the defaults endpoint may also be down.
          defaultModelID: stored.defaultModelID ?? defaultModelID,
          failed: false,
          anonymous,
        }
      : { models: [], imageModels: [], failed: true, failure: fetched.failure, anonymous },
    retry: fetched.failure,
  }
})

export function snapshotKey(server: string, token?: string): string {
  const route = KiloServer.gateway(server)
  if (token === undefined) return `catalog:anonymous:${route}`
  const hash = createHash("sha256").update(`${route}:${token}`).digest("hex")
  return `catalog:personal:${hash}`
}
