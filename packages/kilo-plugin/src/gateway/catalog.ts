export * as GatewayCatalog from "./catalog.js"

import { KiloDefaults, KiloServer, type KiloModels, type KiloProfile } from "@kilocode/gateway-core"
import type { ConnectionInfo } from "@opencode/client"
import type { Connection } from "@opencode/schema/connection"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Effect, Option, Schema, type Result } from "effect"
import { createHash } from "node:crypto"

const MAX_SNAPSHOTS = 10

// The last good catalog of one personal or anonymous scope: its models and its default model.
const decodeSnapshot = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      models: Schema.Array(Schema.Unknown),
      imageModels: Schema.Array(Schema.Unknown).pipe(Schema.optional),
      defaultModelID: Schema.optional(Schema.String),
    }),
  ),
)

export interface SnapshotStorage {
  get(key: string): Effect.Effect<unknown, unknown>
  set(key: string, value: unknown): Effect.Effect<void, unknown>
  remove(key: string): Effect.Effect<void, unknown>
  scan(input: { readonly prefix: string }): Effect.Effect<{ readonly entries: readonly { readonly key: string }[] }, unknown>
}

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
  scope: {
    base: string
    token?: string
    organizationID: string | null
    profileFailure?: KiloProfile.ProfileError["reason"]
  },
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
    const view = applyUnauthorized({ ...snapshot, failed: false, anonymous: result.anonymous }, scope)
    return {
      view,
      retry: models.length === 0 ? { kind: "network" } : undefined,
    }
  }

  // Team failures and rejected credentials never reuse a Personal snapshot.
  const stored = skipSnapshot(scope, fetched.failure)
    ? undefined
    : yield* snapshots.read(snapshotKey(scope.base, scope.token))
  const anonymous = !scope.organizationID && scope.token === undefined
  const base: View = stored
    ? {
        models: stored.models,
        imageModels: stored.imageModels ?? [],
        // The stored default belongs to the stored models; the defaults endpoint may also be down.
        defaultModelID: stored.defaultModelID ?? defaultModelID,
        failed: false,
        anonymous,
      }
    : { models: [], imageModels: [], failed: true, failure: fetched.failure, anonymous }
  return {
    view: applyUnauthorized(base, scope),
    retry: fetched.failure,
  }
})

function skipSnapshot(
  scope: { readonly organizationID: string | null; readonly profileFailure?: KiloProfile.ProfileError["reason"] },
  failure: KiloModels.Failure,
): boolean {
  return Boolean(scope.organizationID) || scope.profileFailure?.kind === "unauthorized" || failure.kind === "unauthorized"
}

export function createSnapshots(storage: SnapshotStorage): Snapshots {
  const lastGood = new Map<string, Snapshot>()
  return {
    save: (writeKey, snapshot) =>
      Effect.gen(function* () {
        if (!lastGood.has(writeKey) && lastGood.size >= MAX_SNAPSHOTS) {
          const oldest = lastGood.keys().next().value
          if (oldest) lastGood.delete(oldest)
        }
        lastGood.set(writeKey, snapshot)
        if (writeKey.startsWith("catalog:personal:")) {
          const scanned = yield* storage
            .scan({ prefix: "catalog:personal:" })
            .pipe(Effect.orElseSucceed(() => ({ entries: [] })))
          for (const entry of scanned.entries) {
            if (entry.key !== writeKey) {
              yield* storage.remove(entry.key).pipe(Effect.catch(() => Effect.void))
            }
          }
        }
        yield* storage.set(writeKey, JSON.stringify(snapshot)).pipe(Effect.catch(() => Effect.void))
      }),
    read: (key) =>
      Effect.gen(function* () {
        const memory = lastGood.get(key)
        if (memory) return memory
        const value = yield* storage.get(key).pipe(Effect.orElseSucceed(() => undefined))
        const decoded = typeof value === "string" ? Option.getOrUndefined(decodeSnapshot(value)) : undefined
        if (!decoded || decoded.models.length === 0) return undefined
        const snapshot: Snapshot = {
          models: decoded.models as readonly KiloModels.Model[],
          imageModels: (decoded.imageModels ?? []) as readonly KiloModels.Model[],
          defaultModelID: decoded.defaultModelID,
        }
        lastGood.set(key, snapshot)
        return snapshot
      }),
  }
}

export function applyUnauthorized(
  view: View,
  input: {
    readonly token?: string
    readonly organizationID: string | null
    readonly profileFailure?: KiloProfile.ProfileError["reason"]
  },
): View {
  if (view.failure) return view
  const unauthorized = resolveUnauthorized({ ...input, view })
  return unauthorized ? { ...view, failure: unauthorized } : view
}

export function resolveUnauthorized(input: {
  readonly token?: string
  readonly organizationID: string | null
  readonly profileFailure?: KiloProfile.ProfileError["reason"]
  readonly view: View
}): KiloModels.Failure | undefined {
  if (input.view.failure?.kind === "unauthorized") return input.view.failure
  if (!input.token) return undefined
  if (input.profileFailure?.kind === "unauthorized") return input.profileFailure
  if (!input.organizationID && input.view.anonymous) return { kind: "unauthorized", status: 401 }
  return undefined
}

export function isUnauthorized(catalog: {
  readonly account?: { readonly token: string }
  readonly anonymous: boolean
  readonly failure?: KiloModels.Failure
}): boolean {
  return catalog.failure?.kind === "unauthorized" || (Boolean(catalog.account?.token) && catalog.anonymous)
}

// The public reason drops the retry delay, so only a changed kind or status is a change. A failed catalog without a
// reason is a changed scope that is still loading. Rejected Personal tokens keep free models usable while surfacing
// `unauthorized` so clients prompt re-login.
export function status(catalog: {
  readonly failed: boolean
  readonly failure?: KiloModels.Failure
}): KiloGatewayRpc.CatalogStatus {
  const failure = catalog.failed
    ? catalog.failure
    : catalog.failure?.kind === "unauthorized"
      ? catalog.failure
      : undefined
  if (!failure) return { failure: null }
  return { failure: { kind: failure.kind, ...(failure.status === undefined ? {} : { status: failure.status }) } }
}

export function connectionStatus(failure: KiloModels.Failure | undefined): Connection.Status | undefined {
  if (failure?.kind !== "unauthorized") return undefined
  return {
    status: "needs_auth",
    message: KiloGatewayRpc.catalogFailureMessage({
      kind: "unauthorized",
      ...(failure.status === undefined ? {} : { status: failure.status }),
    }),
  }
}

export function connectionKey(connection: ConnectionInfo): string {
  return connection.type === "credential" ? `credential:${connection.id}` : `env:${connection.name}`
}

// Returns the active token if this 401 response rejected the currently active authenticated token.
// Ignores anonymous requests, already-unauthorized catalogs, and stale in-flight requests from before re-login.
export function rejectedActiveToken(
  request: Request,
  catalog: {
    readonly account?: { readonly token: string }
    readonly anonymous: boolean
    readonly failure?: KiloModels.Failure
  },
): string | undefined {
  const current = !catalog.anonymous && catalog.account?.token ? catalog.account.token : undefined
  if (!current || catalog.failure?.kind === "unauthorized") return undefined
  const header = request.headers.get("authorization")
  if (header === null) return current
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() === current ? current : undefined
}

export function snapshotKey(server: string, token?: string): string {
  const route = KiloServer.gateway(server)
  if (token === undefined) return `catalog:anonymous:${route}`
  const hash = createHash("sha256").update(`${route}:${token}`).digest("hex")
  return `catalog:personal:${hash}`
}
