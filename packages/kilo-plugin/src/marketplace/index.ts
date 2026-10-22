import { define } from "@opencode/plugin/effect/plugin"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { ProjectID } from "@opencode/schema/project-id"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { Global } from "@opencode/util/global"
import path from "node:path"
import { Effect, Exit, Option, Result, Schema, Scope } from "effect"
import { KiloMarketplaceRegistry } from "./kilo"
import { McpRegistry } from "./mcp-registry"
import { SkillsShRegistry } from "./skills-sh"
import { Installer } from "./installer"
import { McpError, configFile } from "./mcp"
import type { Entry, Registry } from "./registry"
import { SkillError } from "./skill"

// The marketplace plugin (U-E2-23): the `kilocode.marketplace` RPC. It lists registry items and installs them into
// the places the native plugins already read (skills into a scanned `skills` directory), and records each install in
// plugin storage, so that uninstall removes exactly what install wrote and never a user's own files.
const CATALOG_TTL = 10 * 60 * 1000
const CATALOG_LIMIT = 32
const decodeInstalled = Schema.decodeUnknownOption(Schema.fromJsonString(KiloMarketplaceRpc.Installed))
const decodeSnapshot = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        item: KiloMarketplaceRpc.Item,
        archive: Schema.optional(Schema.String),
        select: Schema.optional(Schema.String),
        payloads: Schema.Array(Schema.Unknown),
        companions: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, archive: Schema.String }))),
      }),
    ),
  ),
)

export const KiloMarketplacePlugin = define<Global.Service | Scope.Scope>({
  id: "kilocode.marketplace",
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    const registries: readonly Registry[] = [
      KiloMarketplaceRegistry.make(),
      SkillsShRegistry.make(),
      McpRegistry.make(),
    ]
    const catalog = new Map<string, { at: number; entries: readonly Entry[] }>()
    const cache = (key: string, at: number, entries: readonly Entry[]) => {
      catalog.delete(key)
      catalog.set(key, { at, entries })
      if (catalog.size > CATALOG_LIMIT) catalog.delete(catalog.keys().next().value!)
      return entries
    }
    // A directory outside version control belongs to the `global` project, whose directory is not the user's project:
    // install into the opened directory then, like config discovery, which walks from it.
    const project =
      ctx.location.project.id === ProjectID.global ? ctx.location.directory : ctx.location.project.directory

    const roots = (scope: KiloMarketplaceRpc.Scope) =>
      scope === "global" ? global.config : path.join(project, KiloConfigFiles.directories[0])

    const manifestKey = (input: { registry: string; kind: string; id: string; scope: KiloMarketplaceRpc.Scope }) =>
      ["installed", input.registry, input.kind, input.id, input.scope, input.scope === "project" ? project : ""].join(
        ":",
      )

    // Only the curated Kilo marketplace is on by default: the other registries list community content nobody at
    // Kilo reviewed, so a user turns them on (`registries.set`). The choice is global, in plugin storage.
    const enabled = ctx.storage.get("registries").pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.map((stored) =>
        Array.isArray(stored) ? new Set(stored.filter((id) => typeof id === "string")) : new Set(["kilo"]),
      ),
    )

    const registryInfo = Effect.gen(function* () {
      const on = yield* enabled
      return registries.map(
        (registry): KiloMarketplaceRpc.RegistryInfo => ({
          id: registry.id,
          name: registry.name,
          description: registry.description,
          kinds: registry.kinds,
          curated: registry.curated,
          searchable: registry.searchable,
          enabled: on.has(registry.id),
        }),
      )
    })

    // Fetches one registry. Without a query, a failing registry falls back to its last stored list.
    const load = (registry: Registry, kind: KiloMarketplaceRpc.Kind, refresh: boolean, query: string | undefined) =>
      Effect.gen(function* () {
        const search = registry.searchable ? query : undefined
        const key = `${registry.id}:${kind}:${search ?? ""}`
        const cached = catalog.get(key)
        if (!refresh && cached && Date.now() - cached.at < CATALOG_TTL) return cached.entries
        const fetched = yield* Effect.tryPromise(() => registry.list(kind, search)).pipe(Effect.result)
        if (Result.isSuccess(fetched)) {
          cache(key, Date.now(), fetched.success)
          if (!search) yield* ctx.storage.set(`catalog:${key}`, JSON.stringify(fetched.success)).pipe(Effect.ignore)
          return fetched.success
        }
        if (cached) return cached.entries
        const stored = search
          ? undefined
          : yield* ctx.storage.get(`catalog:${key}`).pipe(Effect.orElseSucceed(() => undefined))
        const snapshot = typeof stored === "string" ? Option.getOrUndefined(decodeSnapshot(stored)) : undefined
        if (!snapshot) {
          const cause = fetched.failure.cause
          return yield* Effect.fail(`Couldn't load ${registry.name}: ${cause instanceof Error ? cause.message : cause}`)
        }
        return cache(key, 0, snapshot)
      })

    // Lists one kind from every enabled registry. One failing registry does not hide the others; the call fails only
    // when every registry failed. Registries that do not search filter their list by the query here.
    const list = (kind: KiloMarketplaceRpc.Kind, refresh: boolean, query?: string) =>
      Effect.gen(function* () {
        const on = yield* enabled
        const active = registries.filter((registry) => on.has(registry.id) && registry.kinds.includes(kind))
        const results = yield* Effect.forEach(
          active,
          (registry) =>
            load(registry, kind, refresh, query).pipe(
              Effect.mapError((message) => ({ registry: registry.id, message })),
              Effect.result,
            ),
          { concurrency: "unbounded" },
        )
        const entries = results.flatMap((result) => (Result.isSuccess(result) ? result.success : []))
        const failures = results.flatMap((result) => (Result.isFailure(result) ? [result.failure] : []))
        if (failures.length > 0 && failures.length === results.length) {
          return yield* Effect.fail(failures.map((failure) => failure.message).join("; "))
        }
        const needle = query?.trim().toLowerCase()
        const matches = entries.filter(
          (entry) =>
            !needle ||
            registries.find((registry) => registry.id === entry.item.registry)?.searchable ||
            [entry.item.id, entry.item.name, entry.item.description, entry.item.category, ...entry.item.tags].some(
              (text) => text?.toLowerCase().includes(needle),
            ),
        )
        return { entries: matches, failures }
      })

    // Finds the entry to install: one a list already returned, else the registry's list, else a search for the
    // item's last id segment (a searched item is not in the top list).
    const lookup = (registry: string, kind: KiloMarketplaceRpc.Kind, id: string) =>
      Effect.gen(function* () {
        const cached = [...catalog.values()]
          .flatMap((page) => page.entries)
          .find((entry) => entry.item.registry === registry && entry.item.kind === kind && entry.item.id === id)
        if (cached) return cached
        const listed = (yield* list(kind, false)).entries.find(
          (entry) => entry.item.registry === registry && entry.item.id === id,
        )
        if (listed) return listed
        const source = registries.find((item) => item.id === registry)
        if (!source?.searchable) return undefined
        const searched = yield* list(kind, false, id.split("/").at(-1))
        return searched.entries.find((entry) => entry.item.registry === registry && entry.item.id === id)
      })

    const read = (key: string) =>
      ctx.storage.get(key).pipe(
        Effect.orElseSucceed(() => undefined),
        Effect.map((stored) =>
          typeof stored === "string" ? Option.getOrUndefined(decodeInstalled(stored)) : undefined,
        ),
      )

    const installed = Effect.gen(function* () {
      const records: KiloMarketplaceRpc.Installed[] = []
      let after: string | undefined
      do {
        const scanned = yield* ctx.storage
          .scan({ prefix: "installed:", after })
          .pipe(Effect.orElseSucceed(() => ({ entries: [], next: undefined })))
        records.push(
          ...scanned.entries.flatMap((entry) => {
            const decoded =
              typeof entry.value === "string" ? Option.getOrUndefined(decodeInstalled(entry.value)) : undefined
            if (!decoded) return []
            if (decoded.scope === "project" && decoded.project !== project) return []
            return [decoded]
          }),
        )
        after = scanned.next
      } while (after !== undefined)
      return records
    })

    yield* ctx.rpc
      .register(KiloMarketplaceRpc.Definition, {
        list: (input, context) =>
          list(input.kind, input.refresh ?? false, input.query).pipe(
            Effect.map((result) => ({ items: result.entries.map((entry) => entry.item), failures: result.failures })),
            Effect.mapError((message) => context.error("fetch_failed", message)),
          ),
        registries: () => registryInfo,
        "registries.set": (input, context) =>
          Effect.gen(function* () {
            if (!registries.some((registry) => registry.id === input.id)) {
              return yield* Effect.fail(context.error("not_found", `Unknown registry ${input.id}`))
            }
            const on = yield* enabled
            if (input.enabled) on.add(input.id)
            else on.delete(input.id)
            yield* ctx.storage.set("registries", [...on])
            return yield* registryInfo
          }),
        installed: () => installed,
        install: (input, context) =>
          Effect.gen(function* () {
            if (input.kind === "agent") {
              return yield* Effect.fail(context.error("unsupported", "Installing agents is not supported yet"))
            }
            const on = yield* enabled
            if (!on.has(input.registry)) {
              return yield* Effect.fail(
                context.error("not_found", `The ${input.registry} registry is turned off; enable it first`),
              )
            }
            const entry = yield* lookup(input.registry, input.kind, input.id).pipe(
              Effect.mapError((message) => context.error("fetch_failed", message)),
            )
            if (!entry) {
              return yield* Effect.fail(context.error("not_found", `No ${input.kind} ${input.id} in ${input.registry}`))
            }
            const key = manifestKey(input)
            const previous = yield* read(key)
            const written = yield* Effect.tryPromise(async () =>
              Installer.install({
                entry,
                skills: path.join(roots(input.scope), "skills"),
                config: await configFile(input.scope === "global" ? global.config : project, input.scope === "global"),
                option: input.option,
                params: input.params,
                previous,
              }),
            ).pipe(
              Effect.mapError((error) => {
                const [name, message] = reason(error.cause)
                return context.error(name, message)
              }),
            )
            let record: KiloMarketplaceRpc.Installed = {
              registry: input.registry,
              kind: input.kind,
              id: input.id,
              scope: input.scope,
              project: input.scope === "project" ? project : undefined,
              paths: written.paths,
              config: written.config,
              server: written.server,
              pending: written.pending,
              installedAt: Date.now(),
            }
            yield* ctx.storage.set(key, JSON.stringify(record))
            for (const resource of written.pending ?? []) {
              const cleaned = yield* Effect.tryPromise(() => Installer.cleanup(resource)).pipe(Effect.result)
              if (Result.isFailure(cleaned)) {
                yield* Effect.logWarning(
                  "Marketplace obsolete resource cleanup failed; retained for retry",
                  resource,
                  cleaned.failure,
                )
                continue
              }
              const pending = record.pending?.filter((entry) => entry !== resource)
              const next = { ...record, pending: pending?.length ? pending : undefined }
              const saved = yield* ctx.storage.set(key, JSON.stringify(next)).pipe(Effect.exit)
              if (Exit.isFailure(saved)) {
                yield* Effect.logWarning(
                  "Marketplace cleanup progress could not be saved; retained for retry",
                  saved.cause,
                )
                break
              }
              record = next
            }
            return record
          }),
        uninstall: (input, context) =>
          Effect.gen(function* () {
            const key = manifestKey(input)
            const record = yield* read(key)
            if (!record) {
              return yield* Effect.fail(
                context.error("not_found", `${input.id} was not installed from the marketplace`),
              )
            }
            yield* Effect.tryPromise(() => Installer.uninstall(record)).pipe(
              Effect.mapError((error) => {
                const [name, message] = reason(error.cause)
                return context.error(name, message)
              }),
            )
            yield* ctx.storage.remove(key)
            return {}
          }),
      })
      .pipe(Effect.orDie)
  }),
})

// Maps an install or uninstall failure to an error name of the contract.
function reason(cause: unknown) {
  if (cause instanceof SkillError)
    return [cause.reason === "conflict" ? "conflict" : "invalid_params", cause.message] as const
  if (cause instanceof McpError) return [cause.reason, cause.message] as const
  if (cause instanceof Installer.FetchError) return ["fetch_failed", cause.message] as const
  return ["write_failed", cause instanceof Error ? cause.message : String(cause)] as const
}
