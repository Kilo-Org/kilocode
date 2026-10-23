import type { ProviderInfo } from "@opencode/client"
import { define } from "@opencode/plugin/effect/plugin"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { ProviderUsage } from "@opencode/schema/kilocode/provider-usage"
import { createHash } from "node:crypto"
import { Effect, Option } from "effect"
import { UsageCloud } from "./cloud"
import { CodexUsage } from "./codex"
import { MiniMaxUsage } from "./minimax"

// Plans and usage (U-E1-06): the `kilocode.provider-usage` RPC behind `/usage`. v1 served the same answer at
// `/kilocode/provider-usage` from the ProviderUsage Location service. Kilo coding plans come from the
// `kilocode.gateway` RPC; ChatGPT Codex and MiniMax Token Plan usage is read with the credentials of their providers.
const successTtl = 60_000
const errorTtl = 10_000

interface Cell {
  identity: string
  value: ProviderUsage.UsageSnapshot
  expires: number
}

export interface Options {
  /** The fetch of the direct sources. Tests pass a local stand-in. */
  readonly fetch?: typeof fetch
}

export const create = (options: Options = {}) =>
  define({
    id: "kilocode.provider-usage",
    effect: Effect.fn(function* (ctx) {
      const fetcher = options.fetch ?? fetch
      const gateway = ctx.rpc(KiloGatewayRpc.Definition)
      const cache = new Map<string, Cell>()

      // A direct source is cached per credential, so a new key never shows the quota of the previous one. A failed
      // fetch keeps the last good windows and marks them stale, as in v1.
      const source = (id: string, secret: string, force: boolean, load: () => Promise<ProviderUsage.UsageSnapshot>) =>
        Effect.promise(async () => {
          const identity = createHash("sha256").update(secret).digest("hex")
          const cell = cache.get(id)
          const previous = cell?.identity === identity ? cell.value : undefined
          if (!force && previous && cell!.expires > Date.now()) return previous
          const value = stale(await load(), previous)
          cache.set(id, {
            identity,
            value,
            expires: Date.now() + (value.fetchState === "ready" ? successTtl : errorTtl),
          })
          return value
        })

      // v1 shows coding plans only for a personal account: a team has no coding plans.
      const managed = Effect.gen(function* () {
        const status = yield* gateway.authStatus({})
        if (!status.authenticated || status.organizationID) return []
        const [subscriptions, byok] = yield* Effect.all([gateway.codingPlans({}), gateway.byok({})], {
          concurrency: 2,
        })
        return yield* Effect.forEach(
          UsageCloud.plans(subscriptions, byok),
          (subscription) =>
            gateway.codingPlanUsage({ subscriptionID: subscription.id }).pipe(
              Effect.option,
              Effect.map((usage) =>
                UsageCloud.snapshot(subscription, Option.getOrUndefined(usage), UsageCloud.app(status.server)),
              ),
            ),
          { concurrency: "unbounded" },
        )
      }).pipe(Effect.orElseSucceed((): ProviderUsage.UsageSnapshot[] => []))

      const credential = (provider: ProviderInfo) =>
        Effect.gen(function* () {
          const connection = yield* ctx.integration.connection.active(provider.integrationID ?? provider.id)
          if (!connection) return undefined
          return yield* ctx.integration.connection.resolve(connection)
        }).pipe(Effect.orElseSucceed(() => undefined))

      const minimax = (providers: readonly ProviderInfo[], force: boolean) =>
        Effect.forEach(
          providers.filter((provider) => provider.id in MiniMaxUsage.bindings && provider.activation !== "disabled"),
          (provider) =>
            Effect.gen(function* () {
              const value = yield* credential(provider)
              const key = (value?.type === "key" ? value.key : configuredKey(provider))?.trim()
              if (!key?.startsWith("sk-cp")) return []
              const candidate = { providerID: provider.id as MiniMaxUsage.ProviderID, label: provider.name, key }
              const id = `minimax-direct-${MiniMaxUsage.bindings[candidate.providerID].region}`
              return [yield* source(id, key, force, () => MiniMaxUsage.load(candidate, fetcher))]
            }),
          { concurrency: "unbounded" },
        ).pipe(Effect.map((items) => items.flat()))

      const codex = (providers: readonly ProviderInfo[], force: boolean) =>
        Effect.gen(function* () {
          const provider = providers.find((item) => item.id === "openai" && item.activation !== "disabled")
          if (!provider) return []
          const value = yield* credential(provider)
          if (value?.type !== "oauth" || !value.access) return []
          const raw = value.metadata?.accountID
          const account = typeof raw === "string" && /^[A-Za-z0-9._-]{1,256}$/.test(raw) ? raw : undefined
          const candidate = { label: provider.name, access: value.access, ...(account ? { account } : {}) }
          return [
            yield* source("codex-chatgpt", JSON.stringify([raw, value.access, value.refresh]), force, () =>
              CodexUsage.load(candidate, fetcher),
            ),
          ]
        })

      const evaluate = (force: boolean) =>
        Effect.gen(function* () {
          const providers = yield* ctx.provider.list().pipe(
            Effect.map((result) => result.data),
            Effect.orElseSucceed((): readonly ProviderInfo[] => []),
          )
          const groups = yield* Effect.all([managed, minimax(providers, force), codex(providers, force)], {
            concurrency: "unbounded",
          })
          const items = groups.flat()
          const ids = new Set(items.map((item) => item.id))
          for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id)
          return { items, generatedAt: new Date().toISOString() }
        })

      yield* ctx.rpc
        .register(ProviderUsage.Definition, { get: () => evaluate(false), refresh: () => evaluate(true) })
        .pipe(Effect.orDie)
    }),
  })

export const KiloProviderUsagePlugin = create()

function stale(next: ProviderUsage.UsageSnapshot, previous: ProviderUsage.UsageSnapshot | undefined) {
  if (next.fetchState === "ready" || next.error?.retryable === false) return next
  if (!previous || (previous.fetchState !== "ready" && previous.fetchState !== "stale")) return next
  return { ...previous, fetchState: "stale" as const, planState: next.planState, error: next.error }
}

function configuredKey(provider: ProviderInfo) {
  const header = Object.entries(provider.headers ?? {}).find(([key]) => key.toLowerCase() === "x-api-key")?.[1]
  const value = provider.body?.apiKey ?? provider.settings?.apiKey ?? header
  return typeof value === "string" ? value : undefined
}
