import { Context, Effect, Layer, Schema } from "effect"
import { createHash } from "node:crypto"
import * as Auth from "@/auth"
import { InstanceState } from "@/effect/instance-state"
import * as Provider from "@/provider/provider"
import * as Cloud from "./cloud"
import { direct } from "@/kilocode/provider/minimax/usage"
import type { Info, UsageSnapshot } from "./schema"

const successTtl = 60_000
const errorTtl = 10_000

export interface AdapterContext {
  providers: Record<string, Provider.Info>
  auth: Auth.Info | undefined
  cloud: (() => Promise<Cloud.CloudState>) | undefined
  token: string | undefined
  cloudIdentity: string | undefined
  fetch: typeof fetch
  source(id: string, load: () => Promise<UsageSnapshot>, identity?: string): Promise<UsageSnapshot>
  preserve(prefix: string, identity?: string): UsageSnapshot[]
  prune(prefix: string, keep: string[]): void
}

interface AdapterResult {
  items: ReadonlyArray<UsageSnapshot>
}

export interface ProviderUsageAdapter {
  cachePrefixes: readonly string[]
  cloudScoped?: boolean
  run(ctx: AdapterContext): Promise<AdapterResult>
}

const managed: ProviderUsageAdapter = {
  cachePrefixes: ["kilo-managed:"],
  cloudScoped: true,
  async run(ctx) {
    if (!ctx.cloud || !ctx.token || !ctx.cloudIdentity) return { items: [] }
    const state = await ctx.cloud()
    if (!state.plans.ok || !state.byok.ok) {
      return { items: ctx.preserve("kilo-managed:", ctx.cloudIdentity) }
    }
    const token = ctx.token
    const identity = ctx.cloudIdentity
    const detected = Cloud.plans(state)
    const ids = detected.map((subscription) => `kilo-managed:${subscription.id}`)
    ctx.prune("kilo-managed:", ids)
    return {
      items: await Promise.all(
        detected.map((subscription) =>
          ctx.source(`kilo-managed:${subscription.id}`, () => Cloud.managed(token, subscription), identity),
        ),
      ),
    }
  },
}

const minimax: ProviderUsageAdapter = {
  cachePrefixes: ["minimax-direct-"],
  async run(ctx) {
    const items = await direct(ctx.providers, ctx.fetch, ctx.source)
    ctx.prune(
      "minimax-direct-",
      items.map((item) => item.id),
    )
    return { items }
  },
}

const registry: readonly ProviderUsageAdapter[] = [managed, minimax]

export class ServiceError extends Schema.TaggedErrorClass<ServiceError>()("ProviderUsageServiceError", {
  message: Schema.String,
}) {}

interface SourceCell {
  identity?: string
  value?: UsageSnapshot
  expires: number
  updatedAt?: string
  inflight?: Promise<UsageSnapshot>
}

interface CloudCell {
  value?: Cloud.CloudState
  expires: number
  updatedAt?: string
  inflight?: Promise<Cloud.CloudState>
}

interface State {
  sources: Map<string, SourceCell>
  cloud: CloudCell
  cloudIdentity?: string
}

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function scopeCloudCache(state: State, token: string | undefined) {
  const identity = token ? fingerprint(token) : undefined
  if (state.cloudIdentity === identity) return identity
  state.cloudIdentity = identity
  state.cloud = { expires: 0 }
  prune(state, "kilo-managed:", [])
  return identity
}

function stale(next: UsageSnapshot, previous: UsageSnapshot | undefined) {
  if (next.fetchState !== "unavailable" && next.fetchState !== "error") return next
  if (!previous || (previous.fetchState !== "ready" && previous.fetchState !== "stale")) return next
  return {
    ...previous,
    fetchState: "stale" as const,
    planState: next.planState,
    routingState: next.routingState,
    managementUrl: next.managementUrl,
    error: next.error,
  }
}

function source(state: State, id: string, force: boolean, load: () => Promise<UsageSnapshot>, identity?: string) {
  const existing = state.sources.get(id)
  const cell: SourceCell = existing && existing.identity === identity ? existing : { expires: 0, identity }
  state.sources.set(id, cell)
  if (!force && cell.value && cell.expires > Date.now()) return Promise.resolve(cell.value)
  if (cell.inflight) return cell.inflight

  const task = load()
    .then((item) => {
      const value = stale(item, cell.value)
      // Skip the write when this cell was superseded (identity change) or pruned
      // while the fetch was in flight; the result must not outlive its credential.
      if (state.sources.get(id) !== cell) return value
      cell.value = value
      cell.updatedAt = new Date().toISOString()
      cell.expires = Date.now() + (value.fetchState === "ready" ? successTtl : errorTtl)
      return value
    })
    .finally(() => {
      cell.inflight = undefined
    })
  cell.inflight = task
  return task
}

function preserve(state: State, prefix: string, identity?: string) {
  const items: UsageSnapshot[] = []
  for (const [id, cell] of state.sources) {
    if (!id.startsWith(prefix) || cell.identity !== identity || !cell.value) continue
    // Only successfully loaded data may be relabeled "stale"; snapshots that
    // never loaded keep their failure state instead of claiming aged data.
    const loaded = cell.value.fetchState === "ready" || cell.value.fetchState === "stale"
    const value = loaded
      ? {
          ...cell.value,
          fetchState: "stale" as const,
          error: {
            code: "source_refresh_unavailable",
            message: "The latest usage could not be loaded.",
            retryable: true,
          },
        }
      : cell.value
    cell.value = value
    cell.updatedAt = new Date().toISOString()
    cell.expires = Date.now() + errorTtl
    items.push(value)
  }
  return items
}

function prune(state: State, prefix: string, keep: string[]) {
  const ids = new Set(keep)
  for (const id of state.sources.keys()) {
    if (!id.startsWith(prefix) || ids.has(id)) continue
    state.sources.delete(id)
  }
}

function cloud(state: State, token: string, identity: string, force: boolean) {
  if (state.cloudIdentity !== identity) return Cloud.load(token)
  const cell = state.cloud
  if (!force && cell.value && cell.expires > Date.now()) return Promise.resolve(cell.value)
  if (cell.inflight) return cell.inflight

  const task = Cloud.load(token)
    .then((value) => {
      if (state.cloudIdentity !== identity) return value
      const failed = Object.values(value).some((result) => !result.ok)
      cell.value = value
      cell.updatedAt = new Date().toISOString()
      cell.expires = Date.now() + (failed ? errorTtl : successTtl)
      return value
    })
    .finally(() => {
      cell.inflight = undefined
    })
  cell.inflight = task
  return task
}

export interface Interface {
  readonly get: () => Effect.Effect<Info, ServiceError>
  readonly refresh: () => Effect.Effect<Info, ServiceError>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/ProviderUsage") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const provider = yield* Provider.Service
    const state = yield* InstanceState.make<State>(() => Effect.succeed({ sources: new Map(), cloud: { expires: 0 } }))

    const evaluate = Effect.fn("ProviderUsage.evaluate")(function* (current: State, force: boolean) {
      const info = yield* auth
        .get("kilo")
        .pipe(Effect.mapError(() => new ServiceError({ message: "Unable to read provider authentication." })))
      const providers = yield* provider.list()
      const token = info?.type === "oauth" && !info.accountId && info.access ? info.access : undefined
      const cloudIdentity = scopeCloudCache(current, token)
      const ctx: AdapterContext = {
        providers,
        auth: info,
        cloud: token && cloudIdentity ? () => cloud(current, token, cloudIdentity, force) : undefined,
        token,
        cloudIdentity,
        fetch,
        source: (id, load, identity) => source(current, id, force, load, identity),
        preserve: (prefix, identity) => preserve(current, prefix, identity),
        prune: (prefix, keep) => prune(current, prefix, keep),
      }
      const results = yield* Effect.promise(() =>
        Promise.all(
          registry.map((adapter) =>
            adapter.run(ctx).catch(
              (): AdapterResult => ({
                items: adapter.cachePrefixes.flatMap((prefix) =>
                  ctx.preserve(prefix, adapter.cloudScoped ? ctx.cloudIdentity : undefined),
                ),
              }),
            ),
          ),
        ),
      )
      const stamps = [current.cloud.updatedAt, ...[...current.sources.values()].map((cell) => cell.updatedAt)].filter(
        (value): value is string => value !== undefined,
      )
      return {
        items: results.flatMap((result) => result.items),
        generatedAt: stamps.toSorted().at(-1) ?? new Date().toISOString(),
      } satisfies Info
    })

    const run = (force: boolean) => InstanceState.useEffect(state, (current) => evaluate(current, force))

    return Service.of({
      get: () => run(false),
      refresh: () => run(true),
    })
  }),
)

export const defaultLayer = layer

export * from "./schema"
export * as ProviderUsage from "."
