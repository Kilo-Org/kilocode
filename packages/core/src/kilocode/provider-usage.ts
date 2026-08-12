export * as ProviderUsage from "./provider-usage"

import { Context, Effect, Layer, Schema } from "effect"
import { createHash } from "node:crypto"
import { ProviderUsage as Contract } from "@opencode-ai/schema/kilocode/provider-usage"
import { Catalog } from "../catalog"
import { makeGlobalNode, makeLocationNode } from "../effect/app-node"
import { Integration } from "../integration"
import { PluginV2 } from "../plugin"
import { ProviderV2 } from "../provider"
import * as Cloud from "./provider-usage/cloud"
import { bindings, direct, type Candidate } from "./provider-usage/minimax/usage"

const successTtl = 60_000
const errorTtl = 10_000
const readyPlugin = PluginV2.ID.make("config-provider")

interface AdapterContext {
  candidates: readonly Candidate[]
  failedCandidates: readonly Candidate["providerID"][]
  cloud: (() => Promise<Cloud.CloudState>) | undefined
  token: string | undefined
  cloudIdentity: string | undefined
  cloudReliable: boolean
  fetch: typeof fetch
  usage: typeof Cloud.fetchCodingPlanUsage
  identityCurrent(identity: string): boolean
  source(id: string, load: () => Promise<Contract.UsageSnapshot>, identity?: string): Promise<Contract.UsageSnapshot>
  preserve(prefix: string, identity?: string): Contract.UsageSnapshot[]
  prune(prefix: string, keep: string[]): void
}

interface AdapterResult {
  items: ReadonlyArray<Contract.UsageSnapshot>
}

interface Adapter {
  cachePrefixes: readonly string[]
  cloudScoped?: boolean
  run(ctx: AdapterContext): Promise<AdapterResult>
}

const managed: Adapter = {
  cachePrefixes: ["kilo-managed:"],
  cloudScoped: true,
  async run(ctx) {
    if (!ctx.cloud || !ctx.token || !ctx.cloudIdentity) {
      return { items: ctx.cloudReliable ? [] : ctx.preserve("kilo-managed:") }
    }
    const state = await ctx.cloud()
    if (!ctx.identityCurrent(ctx.cloudIdentity)) return { items: [] }
    if (!state.plans.ok || !state.byok.ok) return { items: ctx.preserve("kilo-managed:", ctx.cloudIdentity) }
    const token = ctx.token
    const identity = ctx.cloudIdentity
    const detected = Cloud.plans(state)
    const ids = detected.map((subscription) => `kilo-managed:${subscription.id}`)
    ctx.prune("kilo-managed:", ids)
    return {
      items: await Promise.all(
        detected.map((subscription) =>
          ctx.source(`kilo-managed:${subscription.id}`, () => Cloud.managed(token, subscription, ctx.usage), identity),
        ),
      ),
    }
  },
}

const minimax: Adapter = {
  cachePrefixes: ["minimax-direct-"],
  async run(ctx) {
    const items = await direct(ctx.candidates, ctx.fetch, ctx.source)
    // A candidate is either live or failed, never both, so the id sets are disjoint.
    const stale = ctx.failedCandidates.flatMap((id) => ctx.preserve(`minimax-direct-${bindings[id].region}`))
    const merged = [...items, ...stale]
    ctx.prune(
      "minimax-direct-",
      merged.map((item) => item.id),
    )
    return { items: merged }
  },
}

const registry: readonly Adapter[] = [managed, minimax]

export class ServiceError extends Schema.TaggedErrorClass<ServiceError>()("ProviderUsageServiceError", {
  message: Schema.String,
}) {}

interface SourceCell {
  identity?: string
  value?: Contract.UsageSnapshot
  expires: number
  updatedAt?: string
  inflight?: Promise<Contract.UsageSnapshot>
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

function stale(next: Contract.UsageSnapshot, previous: Contract.UsageSnapshot | undefined) {
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

function source(
  state: State,
  id: string,
  force: boolean,
  load: () => Promise<Contract.UsageSnapshot>,
  identity?: string,
) {
  const existing = state.sources.get(id)
  const cell: SourceCell = existing && existing.identity === identity ? existing : { expires: 0, identity }
  state.sources.set(id, cell)
  if (!force && cell.value && cell.expires > Date.now()) return Promise.resolve(cell.value)
  if (cell.inflight) return cell.inflight

  const task = load()
    .then((item) => {
      const value = stale(item, cell.value)
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
  const items: Contract.UsageSnapshot[] = []
  for (const [id, cell] of state.sources) {
    if (!id.startsWith(prefix) || (identity !== undefined && cell.identity !== identity) || !cell.value) continue
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

function cloud(state: State, token: string, identity: string, force: boolean, transport: TransportInterface) {
  if (state.cloudIdentity !== identity) return Cloud.load(token, transport)
  const cell = state.cloud
  if (!force && cell.value && cell.expires > Date.now()) return Promise.resolve(cell.value)
  if (cell.inflight) return cell.inflight

  const task = Cloud.load(token, transport)
    .then((value) => {
      if (state.cloudIdentity !== identity) return value
      const failed = Object.values(value).some((result) => !result.ok)
      const previous = cell.value
      if (failed && previous) {
        cell.expires = Date.now() + errorTtl
        return previous
      }
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
  readonly get: () => Effect.Effect<Contract.Info, ServiceError>
  readonly refresh: () => Effect.Effect<Contract.Info, ServiceError>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/ProviderUsage") {}

export interface TransportInterface {
  readonly fetch: typeof fetch
  readonly plans: typeof Cloud.fetchCodingPlanSubscriptions
  readonly byok: typeof Cloud.fetchByokEntries
  readonly usage: typeof Cloud.fetchCodingPlanUsage
}

export class Transport extends Context.Service<Transport, TransportInterface>()("@kilocode/ProviderUsageTransport") {}

const transportLayer = Layer.succeed(Transport, {
  fetch,
  plans: Cloud.fetchCodingPlanSubscriptions,
  byok: Cloud.fetchByokEntries,
  usage: Cloud.fetchCodingPlanUsage,
})

export const transportNode = makeGlobalNode({ service: Transport, layer: transportLayer, deps: [] })

const credential = Effect.fn("ProviderUsage.credential")(function* (
  integrations: Integration.Interface,
  id: Integration.ID,
) {
  const connection = yield* integrations.connection.active(id)
  if (!connection) return undefined
  return yield* integrations.connection
    .resolve(connection)
    .pipe(Effect.mapError(() => new ServiceError({ message: `Unable to resolve provider credential: ${id}` })))
})

const resolve = Effect.fn("ProviderUsage.resolveCredential")(function* (
  integrations: Integration.Interface,
  id: Integration.ID,
) {
  return yield* credential(integrations, id).pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.catch(() => Effect.succeed({ ok: false as const })),
  )
})

function configuredKey(provider: ProviderV2.Info) {
  const header = Object.entries(provider.request.headers).find(([key]) => key.toLowerCase() === "x-api-key")?.[1]
  const value = provider.request.body.apiKey ?? provider.api.settings?.apiKey ?? header
  return typeof value === "string" ? value : undefined
}

function nonempty(value: unknown) {
  if (typeof value !== "string") return undefined
  const text = value.trim()
  return text || undefined
}

const inputs = Effect.fn("ProviderUsage.inputs")(function* (
  catalog: Catalog.Interface,
  integrations: Integration.Interface,
) {
  const providers = yield* catalog.provider.all()
  const byID = new Map(providers.map((provider) => [provider.id, provider]))
  const failedCandidates: Candidate["providerID"][] = []
  const candidates = yield* Effect.forEach(Object.keys(bindings) as (keyof typeof bindings)[], (providerID) =>
    Effect.gen(function* () {
      const provider = byID.get(ProviderV2.ID.make(providerID))
      if (!provider || provider.disabled) return undefined
      const resolved = yield* resolve(integrations, provider.integrationID ?? Integration.ID.make(provider.id))
      if (!resolved.ok) failedCandidates.push(providerID)
      const value = resolved.ok
        ? resolved.value?.type === "key"
          ? resolved.value.key
          : configuredKey(provider)
        : undefined
      if (typeof value !== "string" || !value.trim().startsWith("sk-cp")) return undefined
      return { providerID, label: provider.name, key: value.trim() } satisfies Candidate
    }),
  )
  const kilo = yield* resolve(integrations, Integration.ID.make("kilo"))
  const kiloProvider = byID.get(ProviderV2.ID.kilo)
  const configuredOrg = nonempty(process.env.KILO_ORG_ID) ?? nonempty(kiloProvider?.request.body.kilocodeOrganizationId)
  const organization =
    configuredOrg !== undefined ||
    (kilo.ok && kilo.value?.type === "oauth" && nonempty(kilo.value.metadata?.accountID) !== undefined)
  const cloudReliable = organization || kilo.ok
  const token =
    kilo.ok && kilo.value?.type === "oauth" && !organization && kilo.value.access ? kilo.value.access : undefined
  return {
    candidates: candidates.filter((item): item is Candidate => item !== undefined),
    failedCandidates,
    token,
    cloudReliable,
  }
})

function makeService(
  catalog: Catalog.Interface,
  integrations: Integration.Interface,
  transport: TransportInterface,
  ready: Effect.Effect<void>,
) {
  const state: State = { sources: new Map(), cloud: { expires: 0 } }

  const evaluate = Effect.fn("ProviderUsage.evaluate")(function* (force: boolean) {
    yield* ready
    const current = yield* inputs(catalog, integrations)
    const cloudIdentity = current.cloudReliable ? scopeCloudCache(state, current.token) : state.cloudIdentity
    const ctx: AdapterContext = {
      candidates: current.candidates,
      failedCandidates: current.failedCandidates,
      cloud:
        current.token && cloudIdentity
          ? () => cloud(state, current.token!, cloudIdentity, force, transport)
          : undefined,
      token: current.token,
      cloudIdentity,
      cloudReliable: current.cloudReliable,
      fetch: transport.fetch,
      usage: transport.usage,
      identityCurrent: (identity) => state.cloudIdentity === identity,
      source: (id, load, identity) => source(state, id, force, load, identity),
      preserve: (prefix, identity) => preserve(state, prefix, identity),
      prune: (prefix, keep) => prune(state, prefix, keep),
    }
    const results = yield* Effect.promise(() =>
      Promise.all(
        registry.map((adapter) =>
          // Adapters are expected to be total (they absorb their own failures into
          // unavailable/stale snapshots). This catch is the containment boundary so a
          // faulty future adapter degrades to stale output instead of failing the endpoint.
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
    const stamps = [state.cloud.updatedAt, ...state.sources.values().map((cell) => cell.updatedAt)].filter(
      (value): value is string => value !== undefined,
    )
    return {
      items: results.flatMap((result) => result.items),
      generatedAt: stamps.toSorted().at(-1) ?? new Date().toISOString(),
    } satisfies Contract.Info
  })

  return Service.of({
    get: () => evaluate(false),
    refresh: () => evaluate(true),
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const plugins = yield* PluginV2.Service
    return makeService(yield* Catalog.Service, yield* Integration.Service, yield* Transport, plugins.wait(readyPlugin))
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Catalog.node, Integration.node, PluginV2.node, transportNode],
})

export { Contract as Schema }
