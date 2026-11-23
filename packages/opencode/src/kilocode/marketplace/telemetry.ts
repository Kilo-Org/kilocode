// `Marketplace Item Installed` / `Marketplace Item Removed`, sent by the CLI for every client.
//
// The editors used to send these from their own UI, which missed installs whose dialog closed early,
// Settings-page removals, and every other API client. The CLI sees each operation once, after it
// really happened, so it owns both events now.
//
// Events never carry parameter values, config contents, paths, or error text.

import { Effect } from "effect"
import { Telemetry } from "@kilocode/kilo-telemetry"
import * as Log from "@opencode-ai/core/util/log"
import * as Api from "./api"
import * as Detection from "./detection"
import type { MarketplaceInstallPayload, Scope } from "./schema"

const log = Log.create({ service: "marketplace.telemetry" })
const SCOPES: readonly Scope[] = ["project", "global"]
/** The last observed removal per directory, type, and id; the next one starts after it settles. */
const queue = new Map<string, Promise<void>>()

type Item = { id: string; type: string }
type Where = { directory: string; worktree?: string }

function catalog() {
  return process.env["KILO_MARKETPLACE_BASE_URL"] ? ("custom" as const) : ("public" as const)
}

function list(item: Item) {
  if (item.type === "mcp") return Api.fetchMcps()
  if (item.type === "skill") return Api.fetchSkills()
  if (item.type === "agent") return Api.fetchAgents()
  if (item.type === "plugin") return Api.fetchPlugins()
  return Promise.resolve([])
}

/** The catalog entry for `item`, from the cache the marketplace listing already filled. */
function lookup(item: Item) {
  return list(item).then((items) => items.find((entry) => entry.id === item.id))
}

/**
 * Report a successful install. The install payload carries no display name, so the name comes from
 * the catalog; a failed lookup still reports the install. Never delays or fails the request.
 */
export function installed(payload: MarketplaceInstallPayload) {
  return Effect.sync(() => {
    if (!Telemetry.isEnabled()) return
    const params = payload.parameters ?? {}
    const method = typeof params.__method === "string" && params.__method ? params.__method : undefined
    const keys = Object.keys(params).filter((key) => key !== "__method")
    const send = (name?: string) =>
      Telemetry.trackMarketplaceItemInstalled({
        itemId: payload.item.id,
        itemType: payload.item.type,
        ...(name && { itemName: name }),
        target: payload.target ?? "project",
        catalog: catalog(),
        ...(keys.length > 0 && { hasParameters: true }),
        ...(method && { installationMethodName: method }),
      })
    void lookup(payload.item)
      .then(
        (match) => send(match?.name),
        (err: unknown) => {
          log.warn("marketplace catalog lookup failed", { err })
          send()
        },
      )
      .catch((err: unknown) => log.warn("marketplace install telemetry failed", { err }))
  })
}

function snapshot(where: Where, item: Item) {
  return Promise.all(SCOPES.map((scope) => Detection.present(scope, where, item))).catch((err: unknown) => {
    log.warn("marketplace presence check failed", { err })
    return SCOPES.map(() => false)
  })
}

/** Resolves once the event is queued, or skipped because the item is not in the catalog. */
function report(item: Item, scopes: readonly Scope[]) {
  return lookup(item)
    .then((match) => {
      if (!match) return
      for (const target of scopes) {
        Telemetry.trackMarketplaceItemRemoved({
          itemId: match.id,
          itemType: match.type,
          itemName: match.name,
          target,
          catalog: catalog(),
        })
      }
    })
    .catch((err: unknown) => log.warn("marketplace removal telemetry failed", { err }))
}

/**
 * Run a removal and report one `Marketplace Item Removed` per scope it actually emptied.
 *
 * Settings pages remove any configured MCP server, skill, or agent through these endpoints, and the
 * marketplace endpoint succeeds for a scope that never held the item. So an event needs the item to
 * disappear from a scope and its id to name an item of that type in the catalog. The catalog lookup
 * runs in the background and never delays or fails the removal.
 */
export function removal<A, E, R>(where: Where, item: Item, run: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    if (!Telemetry.isEnabled()) return yield* run
    const key = `${where.directory}\0${item.type}\0${item.id}`
    // Overlapping removals of the same item would share before/after pairs, counting one removal
    // twice or not at all. Running them one after another gives each its own pair; the installer
    // already serializes the writes per scope, so this adds no meaningful wait.
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        const prior = queue.get(key) ?? Promise.resolve()
        const done = Promise.withResolvers<void>()
        const tail = prior.then(() => done.promise)
        queue.set(key, tail)
        return { prior, done, tail }
      }),
      (slot) => Effect.promise(() => slot.prior).pipe(Effect.andThen(observe(where, item, run))),
      (slot) =>
        Effect.sync(() => {
          slot.done.resolve()
          if (queue.get(key) === slot.tail) queue.delete(key)
        }),
    )
  })
}

function observe<A, E, R>(where: Where, item: Item, run: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const before = yield* Effect.promise(() => snapshot(where, item))
    // Check afterwards even when the removal fails: it can delete files before a later step errors.
    const check = Effect.promise(() => snapshot(where, item)).pipe(
      Effect.map((after) => {
        const scopes = SCOPES.filter((_, index) => before[index] && !after[index])
        if (scopes.length > 0) void report(item, scopes)
      }),
    )
    return yield* run.pipe(Effect.ensuring(check))
  })
}
