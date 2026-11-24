export * as GatewayAutoPreview from "./auto-preview.js"

import { createHash } from "node:crypto"
import { KiloAutoPreview } from "@kilocode/gateway-core"
import type { RpcHandlers } from "@opencode/plugin/effect/rpc"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import type { Model } from "@opencode/schema/model"
import { Cause, Deferred, Effect, Exit } from "effect"

type Methods = RpcHandlers<typeof KiloGatewayRpc.Definition>

export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000
export const DEFAULT_CACHE_MAX_ENTRIES = 100

export interface HandlerInput {
  readonly models: Effect.Effect<readonly Model.Info[]>
  /** Identifies the active Gateway account/org/catalog epoch; changing it clears cached previews. */
  readonly scope?: () => string
  /** Computes a preview on cache miss. Defaults to the local illustrative stub until Cloud ships. */
  readonly compute?: (input: KiloAutoPreview.PreviewInput) => Effect.Effect<KiloAutoPreview.PreviewResult, Error>
  readonly maxEntries?: number
  readonly ttlMs?: number
  readonly now?: () => number
}

interface CacheEntry {
  readonly value: KiloAutoPreview.PreviewResult
  readonly expiresAt: number
}

function cacheKey(scope: string, payload: KiloAutoPreview.PreviewInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        scope,
        prompt: payload.prompt,
        agent: payload.agent ?? null,
        profile: payload.profile ?? null,
        currentModel: payload.currentModel
          ? {
              providerID: payload.currentModel.providerID,
              id: payload.currentModel.id,
              name: payload.currentModel.name ?? null,
              cost: payload.currentModel.cost ?? null,
            }
          : null,
      }),
    )
    .digest("hex")
}

function createCache(opts: { readonly maxEntries: number; readonly ttlMs: number; readonly now: () => number }) {
  const entries = new Map<string, CacheEntry>()
  const inflight = new Map<string, Deferred.Deferred<KiloAutoPreview.PreviewResult, Error>>()
  let activeScope = ""

  const syncScope = (raw: string) => {
    const scope = raw ? createHash("sha256").update(raw).digest("hex") : ""
    if (scope !== activeScope) {
      entries.clear()
      activeScope = scope
    }
    return scope
  }

  const get = (key: string) => {
    const hit = entries.get(key)
    if (!hit) return undefined
    if (opts.now() >= hit.expiresAt) {
      entries.delete(key)
      return undefined
    }
    // Refresh insertion order for LRU eviction.
    entries.delete(key)
    entries.set(key, hit)
    return hit.value
  }

  const set = (key: string, scope: string, value: KiloAutoPreview.PreviewResult) => {
    if (scope !== activeScope || opts.maxEntries <= 0 || opts.ttlMs <= 0) return
    entries.delete(key)
    entries.set(key, { value, expiresAt: opts.now() + opts.ttlMs })
    while (entries.size > opts.maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  return { inflight, syncScope, get, set }
}

export function handlers(input: HandlerInput): Pick<Methods, "autoModel.preview"> {
  const compute = input.compute ?? ((payload) => Effect.sync(() => KiloAutoPreview.preview(payload)))
  const cache = createCache({
    maxEntries: input.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES,
    ttlMs: input.ttlMs ?? DEFAULT_CACHE_TTL_MS,
    now: input.now ?? Date.now,
  })

  const run = (key: string, scope: string, payload: KiloAutoPreview.PreviewInput) =>
    Effect.gen(function* () {
      const cached = cache.get(key)
      if (cached) return cached

      const pending = cache.inflight.get(key)
      if (pending) {
        const exit = yield* Effect.exit(Deferred.await(pending))
        if (Exit.isSuccess(exit) || !Cause.hasInterruptsOnly(exit.cause)) return yield* exit
      }

      const deferred = Deferred.makeUnsafe<KiloAutoPreview.PreviewResult, Error>()
      const release = () => {
        if (cache.inflight.get(key) === deferred) cache.inflight.delete(key)
      }
      return yield* Effect.uninterruptibleMask((restore) => {
        cache.inflight.set(key, deferred)
        return restore(compute(payload)).pipe(
          Effect.onExit((exit) => {
            release()
            if (Exit.isSuccess(exit)) cache.set(key, scope, exit.value)
            return Deferred.done(deferred, exit)
          }),
        )
      })
    })

  return {
    "autoModel.preview": (args, context) =>
      Effect.gen(function* () {
        const prompt = args.prompt.trim()
        if (!prompt)
          return yield* Effect.fail(context.error("failed", "Prompt is required to preview Auto Model selection"))
        const current = args.currentModel ? yield* resolveCurrentModel(args.currentModel, input.models) : undefined
        const payload: KiloAutoPreview.PreviewInput = {
          prompt,
          ...(args.agent ? { agent: args.agent } : {}),
          ...(current ? { currentModel: current } : {}),
          ...(args.profile ? { profile: args.profile } : {}),
        }
        const scope = cache.syncScope(input.scope?.() ?? "")
        return yield* run(cacheKey(scope, payload), scope, payload).pipe(
          Effect.mapError((err) => context.error("failed", err.message)),
        )
      }),
  }
}

function resolveCurrentModel(
  ref: NonNullable<KiloGatewayRpc.AutoModelPreviewInput["currentModel"]>,
  models: Effect.Effect<readonly Model.Info[]>,
) {
  return Effect.gen(function* () {
    const list = yield* models
    const found = list.find((item) => item.providerID === ref.providerID && item.id === ref.id)
    const cost = found?.cost.find((item) => item.tier === undefined) ?? found?.cost[0]
    return {
      providerID: ref.providerID,
      id: ref.id,
      ...(ref.name ?? found?.name ? { name: ref.name ?? found?.name } : {}),
      ...(cost ? { cost: { input: cost.input, output: cost.output } } : {}),
    }
  })
}
