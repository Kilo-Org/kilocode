import { Context, Effect, Layer, Schema } from "effect"
import * as Auth from "@/auth"
import { InstanceState } from "@/effect/instance-state"
import * as Provider from "@/provider/provider"
import * as Cloud from "./cloud"
import { direct } from "@/kilocode/provider/minimax/usage"
import { codex } from "@/kilocode/provider/codex/usage"
import type { Info, KiloBilling, UsageSnapshot } from "./schema"

const successTtl = 60_000
const errorTtl = 10_000

export interface AdapterContext {
  providers: Record<string, Provider.Info>
  auth: {
    kilo: Auth.Info | undefined
    openai: Auth.Info | undefined
  }
  cloud: (() => Promise<Cloud.CloudState>) | undefined
  token: string | undefined
  fetch: typeof fetch
  source(id: string, load: () => Promise<UsageSnapshot>): Promise<UsageSnapshot>
  preserve(prefix: string): UsageSnapshot[]
  prune(prefix: string, keep: string[]): void
}

interface AdapterResult {
  items: ReadonlyArray<UsageSnapshot>
  kiloBilling?: KiloBilling
}

export interface ProviderUsageAdapter {
  id: string
  providerIDs: readonly string[]
  cachePrefixes: readonly string[]
  run(ctx: AdapterContext): Promise<AdapterResult>
}

const billing: ProviderUsageAdapter = {
  id: "kilo-billing",
  providerIDs: ["kilo"],
  cachePrefixes: [],
  async run(ctx) {
    if (!ctx.cloud) return { items: [] }
    const state = await ctx.cloud()
    return { items: [], kiloBilling: Cloud.billing(state) }
  },
}

const managed: ProviderUsageAdapter = {
  id: "kilo-managed-minimax",
  providerIDs: ["kilo", "minimax"],
  cachePrefixes: ["kilo-managed-minimax:"],
  async run(ctx) {
    if (!ctx.cloud || !ctx.token) return { items: [] }
    const state = await ctx.cloud()
    if (!state.plans.ok) return { items: ctx.preserve("kilo-managed-minimax:") }
    const token = ctx.token
    const detected = Cloud.plans(state)
    const ids = detected.map((subscription) => `kilo-managed-minimax:${subscription.id}`)
    ctx.prune("kilo-managed-minimax:", ids)
    return {
      items: await Promise.all(
        detected.map((subscription) =>
          ctx.source(`kilo-managed-minimax:${subscription.id}`, () => Cloud.managed(token, subscription)),
        ),
      ),
    }
  },
}

const minimax: ProviderUsageAdapter = {
  id: "direct-minimax",
  providerIDs: ["minimax-coding-plan", "minimax-cn-coding-plan"],
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

const openai: ProviderUsageAdapter = {
  id: "codex",
  providerIDs: ["openai"],
  cachePrefixes: ["codex-chatgpt"],
  async run(ctx) {
    const provider = ctx.providers.openai
    if (
      ctx.auth.openai?.type !== "oauth" ||
      !provider ||
      provider.source !== "custom" ||
      typeof provider.options.fetch !== "function"
    ) {
      ctx.prune("codex-chatgpt", [])
      return { items: [] }
    }
    const item = await ctx.source("codex-chatgpt", async () => {
      const items = await codex(ctx.auth.openai, ctx.providers)
      return items[0]
    })
    return { items: [item] }
  },
}

export const registry: readonly ProviderUsageAdapter[] = [billing, managed, minimax, openai]

export class ServiceError extends Schema.TaggedErrorClass<ServiceError>()("ProviderUsageServiceError", {
  message: Schema.String,
}) {}

interface SourceCell {
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

function source(state: State, id: string, force: boolean, load: () => Promise<UsageSnapshot>) {
  const cell = state.sources.get(id) ?? { expires: 0 }
  state.sources.set(id, cell)
  if (!force && cell.value && cell.expires > Date.now()) return Promise.resolve(cell.value)
  if (cell.inflight) return cell.inflight

  const task = load()
    .then((item) => {
      const value = stale(item, cell.value)
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

function preserve(state: State, prefix: string) {
  const items: UsageSnapshot[] = []
  for (const [id, cell] of state.sources) {
    if (!id.startsWith(prefix) || !cell.value) continue
    const value = {
      ...cell.value,
      fetchState: "stale" as const,
      error: {
        code: "source_refresh_unavailable",
        message: "The latest usage could not be loaded.",
        retryable: true,
      },
    }
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

function cloud(state: State, token: string, force: boolean) {
  const cell = state.cloud
  if (!force && cell.value && cell.expires > Date.now()) return Promise.resolve(cell.value)
  if (cell.inflight) return cell.inflight

  const task = Cloud.load(token)
    .then((value) => {
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
      const [kilo, openai] = yield* Effect.all([auth.get("kilo"), auth.get("openai")]).pipe(
        Effect.mapError(() => new ServiceError({ message: "Unable to read provider authentication." })),
      )
      const providers = yield* provider.list()
      const token = kilo?.type === "oauth" && !kilo.accountId && kilo.access ? kilo.access : undefined
      const ctx: AdapterContext = {
        providers,
        auth: { kilo, openai },
        cloud: token ? () => cloud(current, token, force) : undefined,
        token,
        fetch,
        source: (id, load) => source(current, id, force, load),
        preserve: (prefix) => preserve(current, prefix),
        prune: (prefix, keep) => prune(current, prefix, keep),
      }
      const results = yield* Effect.promise(() =>
        Promise.all(
          registry.map((adapter) =>
            adapter
              .run(ctx)
              .catch((): AdapterResult => ({ items: adapter.cachePrefixes.flatMap((prefix) => ctx.preserve(prefix)) })),
          ),
        ),
      )
      const kiloBilling = results.find((result) => result.kiloBilling)?.kiloBilling
      const stamps = [current.cloud.updatedAt, ...[...current.sources.values()].map((cell) => cell.updatedAt)].filter(
        (value): value is string => value !== undefined,
      )
      return {
        items: results.flatMap((result) => result.items),
        ...(kiloBilling ? { kiloBilling } : {}),
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
