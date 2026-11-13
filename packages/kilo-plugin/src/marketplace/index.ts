import { define } from "@opencode/plugin/effect/plugin"
import type { RpcCallContext } from "@opencode/plugin/effect/rpc"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { ProjectID } from "@opencode/schema/project-id"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { Global } from "@opencode/util/global"
import { Npm } from "@opencode/util/npm"
import path from "node:path"
import { Effect, Exit, Option, Result, Schema, Scope } from "effect"
import { KiloMarketplaceRegistry } from "./kilo"
import { Agent, AgentError } from "./agent"
import { MarketplaceConfig } from "./config"
import { Installer } from "./installer"
import { MarketplaceMcp, McpError, configFile } from "./mcp"
import { PluginConfig } from "./plugin-config"
import { PluginPackageError, resolve as resolvePlugin } from "./plugin-package"
import { pluginIdentity } from "./plugin-spec"
import { catalogKey, type Entry } from "./registry"
import { SkillError, safe } from "./skill"

const CATALOG_TTL = 10 * 60 * 1000

// Resources are decoded one at a time: a resource kind this build does not know (an agent written by a newer
// build, say) is dropped instead of failing the record and orphaning the files it names.
// The stored record keeps `kind` as the closed `Kind` literal on purpose, so a record written by a build with a
// newer kind is skipped instead of being guessed at with this build's resource rules (the config entry stays
// active and `/plugins` can disable it); only `resources` and `pending` are decoded tolerantly.
const Stored = Schema.Struct({
  ...KiloMarketplaceRpc.Installed.fields,
  resources: Schema.optional(Schema.Array(Schema.Unknown)),
  pending: Schema.optional(Schema.Array(Schema.Unknown)),
})
const decodeStored = Schema.decodeUnknownOption(Schema.fromJsonString(Stored))
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

export const KiloMarketplacePlugin = define<Global.Service | Npm.Service | Scope.Scope>({
  id: "kilocode.marketplace",
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    const npm = yield* Npm.Service
    const registry = KiloMarketplaceRegistry.make()
    const catalog = new Map<KiloMarketplaceRpc.Kind, { at: number; entries: readonly Entry[] }>()
    // An unversioned directory belongs to the global project; install into the actual opened directory then.
    const project =
      ctx.location.project.id === ProjectID.global ? ctx.location.directory : ctx.location.project.directory
    const roots = (scope: KiloMarketplaceRpc.Scope) =>
      scope === "global" ? global.config : path.join(project, KiloConfigFiles.directories[0])
    const directory = (scope: KiloMarketplaceRpc.Scope) => (scope === "global" ? global.config : project)

    const storage = <A>(effect: Effect.Effect<A>, operation: "fetch_failed" | "write_failed", detail: string) =>
      effect.pipe(
        Effect.catchDefect((cause) =>
          Effect.fail(
            new StorageError(operation, `${detail}: ${cause instanceof Error ? cause.message : String(cause)}`),
          ),
        ),
      )

    const respond = <A, E>(
      effect: Effect.Effect<A, E>,
      context: RpcCallContext<typeof KiloMarketplaceRpc.Definition.methods.install>,
    ) =>
      effect.pipe(
        Effect.catchDefect((error) => (error instanceof StorageError ? Effect.fail(error) : Effect.die(error))),
        Effect.mapError((error) => {
          const [name, detail] = reason(error)
          return context.error(name, detail)
        }),
      )

    // The database is the single record of ownership. Intent is written here before every mutation.
    const save = (record: KiloMarketplaceRpc.Installed) =>
      storage(
        ctx.storage.set(manifestKey(record), JSON.stringify(record)),
        "write_failed",
        "Couldn't save marketplace installation. Retry install or uninstall",
      )

    // Absolute resources exist only in memory; stored records keep skill ids, agent ids, server names and a
    // scope-relative config.
    const store = (resource: Installer.Resource): KiloMarketplaceRpc.Resource =>
      "agent" in resource
        ? { agent: resource.agent, fingerprints: resource.fingerprints }
        : "plugin" in resource
          ? { plugin: resource.plugin, fingerprints: resource.fingerprints }
          : "path" in resource
            ? { id: path.basename(resource.path), fingerprints: resource.fingerprints }
            : { server: resource.server, fingerprints: resource.fingerprints }

    const configs = (scope: KiloMarketplaceRpc.Scope) =>
      KiloConfigFiles.writeCandidates(directory(scope), scope === "global")

    // Repository-controlled symlinks cannot authorize a project config outside its native locations.
    const outside = async (scope: KiloMarketplaceRpc.Scope, target: string) =>
      scope === "project" && !(await MarketplaceConfig.nativeTarget(directory(scope), target))

    // An owned entry lives in the first native config that holds it. A missing one is placed where a new install
    // would write it, so repair and cleanup agree on a single resource.
    const locate = async (scope: KiloMarketplaceRpc.Scope, present: (candidate: string) => Promise<boolean>) => {
      // An unreadable candidate is not "entry absent": the entry may be in it, so it is returned and the caller
      // fails on the real read error instead of silently dropping owned content.
      let unreadable: string | undefined
      for (const candidate of configs(scope)) {
        const found = await present(candidate).then(
          (present) => present,
          () => {
            unreadable ??= candidate
            return false
          },
        )
        if (found) return candidate
      }
      return unreadable ?? configFile(directory(scope), scope === "global")
    }

    const restore = async (
      record: KiloMarketplaceRpc.Installed,
    ): Promise<Installer.Written & { id: string; recovering?: boolean }> => {
      // Active entries prefer the recorded config; pending ones may live elsewhere, so they are always located.
      const owned = async (resource: KiloMarketplaceRpc.Resource, preferred?: string): Promise<Installer.Resource> => {
        if ("id" in resource)
          return { path: path.join(roots(record.scope), "skills", resource.id), fingerprints: resource.fingerprints }
        // An agent document is named by its id and located from the current scope, so a project move is safe.
        if ("agent" in resource)
          return {
            agent: resource.agent,
            path: Agent.target(path.join(roots(record.scope), "agents"), resource.agent),
            fingerprints: resource.fingerprints,
          }
        if ("plugin" in resource) {
          const hinted =
            preferred &&
            (await PluginConfig.fingerprint(preferred, resource.plugin).catch(() => undefined)) !== undefined
          const config = hinted
            ? preferred
            : await locate(
                record.scope,
                async (candidate) => (await PluginConfig.fingerprint(candidate, resource.plugin)) !== undefined,
              )
          const target = await MarketplaceConfig.resolveFile(config).catch(() => undefined)
          if (target && (await outside(record.scope, target)))
            throw new McpError("conflict", `Project config resolves outside its native config locations: ${config}`)
          return {
            config,
            plugin: resource.plugin,
            ...(target ? { target } : {}),
            fingerprints: resource.fingerprints,
          }
        }
        const hinted =
          preferred &&
          (await MarketplaceMcp.fingerprint(preferred, resource.server).catch(() => undefined)) !== undefined
        const config = hinted
          ? preferred
          : await locate(
              record.scope,
              async (candidate) => (await MarketplaceMcp.fingerprint(candidate, resource.server)) !== undefined,
            )
        // The canonical file is derived here, never stored, so aliases of one file stay one resource.
        const target = await MarketplaceConfig.resolveFile(config).catch(() => undefined)
        // Every operation restores through here, so a project config that now resolves outside the native
        // candidates (a committed symlink) is refused for uninstall and cleanup as it is for install.
        if (target && (await outside(record.scope, target)))
          throw new McpError("conflict", `Project config resolves outside its native config locations: ${config}`)
        return { config, server: resource.server, ...(target ? { target } : {}), fingerprints: resource.fingerprints }
      }
      const recorded = record.config ? path.join(directory(record.scope), record.config) : undefined
      const resources = await Promise.all((record.resources ?? []).map((resource) => owned(resource, recorded)))
      // The record-level config must name the same file as its MCP resource, or they read as two resources.
      const resolved = resources.find((resource) => "config" in resource)
      const config = resolved && "config" in resolved ? resolved.config : recorded
      return {
        id: record.id,
        paths: resources.flatMap((resource) => ("path" in resource ? [resource.path] : [])),
        ...(config ? { config } : {}),
        ...(record.server ? { server: record.server } : {}),
        resources,
        pending: record.pending ? await Promise.all(record.pending.map((resource) => owned(resource))) : undefined,
        recovering: record.recovering,
      }
    }

    // Clients get the config location resolved for the current scope; the stored record keeps it scope-relative.
    const present = async (record: KiloMarketplaceRpc.Installed): Promise<KiloMarketplaceRpc.Installed> => ({
      ...record,
      ...(record.config ? { config: path.join(directory(record.scope), record.config) } : {}),
      ...(await Installer.inspect(await restore(record))),
    })

    const manifestKey = (input: {
      registry: string
      kind: string
      id: string
      scope: KiloMarketplaceRpc.Scope
      project?: string
    }) =>
      [
        "installed",
        input.registry,
        input.kind,
        input.id,
        input.scope,
        input.scope === "project" ? (input.project ?? project) : "",
      ].join(":")

    const list = (kind: KiloMarketplaceRpc.Kind, refresh: boolean, query?: string) =>
      Effect.gen(function* () {
        const key = catalogKey(registry.id, kind)
        const cached = catalog.get(kind)
        const loaded =
          !refresh && cached && Date.now() - cached.at < CATALOG_TTL
            ? { entries: cached.entries }
            : yield* Effect.gen(function* () {
                const fetched = yield* Effect.tryPromise({ try: () => registry.list(kind), catch: message }).pipe(
                  Effect.result,
                )
                if (Result.isSuccess(fetched)) {
                  catalog.set(kind, { at: Date.now(), entries: fetched.success })
                  yield* storage(
                    ctx.storage.set(key, JSON.stringify(fetched.success)),
                    "write_failed",
                    "Couldn't cache marketplace catalog",
                  ).pipe(Effect.ignore)
                  return { entries: fetched.success }
                }
                const failure = `Couldn't load ${registry.name}: ${fetched.failure}`
                if (cached) return { entries: cached.entries, failure }
                const stored = yield* storage(
                  ctx.storage.get(key),
                  "fetch_failed",
                  "Couldn't read cached marketplace catalog",
                ).pipe(Effect.orElseSucceed(() => undefined))
                const snapshot = typeof stored === "string" ? Option.getOrUndefined(decodeSnapshot(stored)) : undefined
                if (!snapshot) return yield* Effect.fail(failure)
                catalog.set(kind, { at: 0, entries: snapshot })
                return { entries: snapshot, failure }
              })
        const needle = query?.trim().toLowerCase()
        return {
          entries: loaded.entries.filter(
            (entry) =>
              !needle ||
              [
                entry.item.id,
                entry.item.name,
                entry.item.description,
                entry.item.category,
                entry.item.author,
                entry.item.url,
                entry.item.registry,
                ...entry.item.tags,
              ].some((text) => text?.toLowerCase().includes(needle)),
          ),
          failures: "failure" in loaded && loaded.failure ? [{ registry: registry.id, message: loaded.failure }] : [],
        }
      })

    const lookup = (source: string, kind: KiloMarketplaceRpc.Kind, id: string) =>
      Effect.gen(function* () {
        if (source !== registry.id) return undefined
        return (yield* list(kind, false)).entries.find((entry) => entry.item.id === id)
      })

    // A stored record names locations. Anything that could point outside the scope is rejected, not trusted.
    const valid = (record: KiloMarketplaceRpc.Installed) => {
      const inside = (value: string) => {
        const relative = path.relative(directory(record.scope), path.join(directory(record.scope), value))
        return !path.isAbsolute(value) && relative !== ".." && !relative.startsWith(`..${path.sep}`)
      }
      return (
        (record.config === undefined ||
          (inside(record.config) &&
            configs(record.scope).includes(path.join(directory(record.scope), record.config)))) &&
        [...(record.resources ?? []), ...(record.pending ?? [])].every(
          (resource) =>
            !("id" in resource || "agent" in resource) ||
            safe("id" in resource ? resource.id : resource.agent),
        )
      )
    }

    // A resource this build cannot decode is dropped, not fatal: the rest of the record stays owned and removable.
    // Without that, one unknown member would hide every resource the record owns and leave its files behind.
    const known = (stored: typeof Stored.Type): KiloMarketplaceRpc.Installed => ({
      ...stored,
      resources: stored.resources && resources(stored.resources),
      pending: stored.pending && resources(stored.pending),
    })

    const resources = (values: readonly unknown[]) =>
      values.flatMap((value) => Option.toArray(Schema.decodeUnknownOption(KiloMarketplaceRpc.Resource)(value)))

    // Unreadable or untrustworthy rows are skipped so one bad record cannot hide the others; installs stay
    // protected by fingerprints and conflict checks.
    const decode = (value: unknown, key: string) =>
      Effect.gen(function* () {
        const decoded = typeof value === "string" ? decodeStored(value) : Option.none()
        const record = Option.isSome(decoded) ? known(decoded.value) : undefined
        if (record && valid(record)) return record
        yield* Effect.logWarning(`Skipping invalid marketplace record ${key}; no files were removed`)
        return undefined
      })

    const read = (input: { registry: string; kind: string; id: string; scope: KiloMarketplaceRpc.Scope }) =>
      Effect.gen(function* () {
        const key = manifestKey(input)
        const stored = yield* storage(ctx.storage.get(key), "fetch_failed", "Couldn't read marketplace installation")
        return stored === undefined ? undefined : yield* decode(stored, key)
      })

    const installed = Effect.gen(function* () {
      const records: KiloMarketplaceRpc.Installed[] = []
      let after: string | undefined
      do {
        const scanned = yield* storage(
          ctx.storage.scan({ prefix: "installed:", after }),
          "fetch_failed",
          "Couldn't list marketplace installations",
        )
        for (const entry of scanned.entries) {
          const decoded = yield* decode(entry.value, entry.key)
          if (!decoded || (decoded.scope === "project" && decoded.project !== project)) continue
          records.push(decoded)
        }
        after = scanned.next
      } while (after !== undefined)
      // A record that cannot be inspected (its config now resolves outside the native locations, say) is
      // flagged instead of failing the whole list; install and uninstall still refuse it explicitly.
      return yield* Effect.forEach(records, (record) =>
        Effect.promise(() =>
          present(record).catch(
            (error): KiloMarketplaceRpc.Installed => ({
              ...record,
              ...(record.config ? { config: path.join(directory(record.scope), record.config) } : {}),
              status: "modified",
              warnings: [`Couldn't inspect ${record.id}: ${message(error)}`],
            }),
          ),
        ),
      )
    })

    yield* ctx.rpc
      .register(KiloMarketplaceRpc.Definition, {
        list: (input, context) =>
          respond(
            list(input.kind, input.refresh ?? false, input.query).pipe(
              Effect.map((result) => ({ items: result.entries.map((entry) => entry.item), failures: result.failures })),
              Effect.mapError((error) => new StorageError("fetch_failed", error)),
            ),
            context,
          ),
        installed: (_, context) => respond(installed, context),
        preview: (input, context) =>
          respond(
            Effect.gen(function* () {
              const entry = yield* lookup(input.registry, input.kind, input.id).pipe(
                Effect.mapError((error) => new StorageError("fetch_failed", error)),
              )
              if (!entry)
                return yield* Effect.fail(
                  new McpError("not_found", `No ${input.kind} ${input.id} in ${input.registry}`),
                )
              return yield* Effect.tryPromise({
                try: async () => ({
                  ...Installer.preview({ entry, option: input.option, params: input.params }),
                  config: await configFile(directory(input.scope), input.scope === "global"),
                }),
                catch: (error) => error,
              })
            }),
            context,
          ),
        install: (input, context) =>
          respond(
            Effect.gen(function* () {
              const entry = yield* lookup(input.registry, input.kind, input.id).pipe(
                Effect.mapError((error) => new StorageError("fetch_failed", error)),
              )
              if (!entry)
                return yield* Effect.fail(
                  new McpError("not_found", `No ${input.kind} ${input.id} in ${input.registry}`),
                )
              const stored = yield* read(input)
              const previous = stored
                ? yield* Effect.tryPromise({ try: () => restore(stored), catch: (error) => error })
                : undefined
              // Only skills, MCPs and plugins read this, and resolving it can reject an unrelated MCP config.
              const config =
                input.kind === "skill"
                  ? path.join(directory(input.scope), KiloConfigFiles.newFile)
                  : input.kind === "mcp" || input.kind === "plugin"
                    ? yield* Effect.tryPromise({
                        try: () => configFile(directory(input.scope), input.scope === "global"),
                        catch: (error) => error,
                      })
                    : ""
              // A plugin is resolved and installed before its config entry exists, so a target the loader could not
              // activate never becomes an installation.
              if (input.kind === "plugin") {
                const spec = entry.item.plugin?.spec.trim()
                if (!spec)
                  return yield* Effect.fail(new PluginPackageError("invalid_params", `Plugin ${input.id} has no spec`))
                const identity = yield* Effect.promise(() => pluginIdentity(spec))
                if (!identity)
                  return yield* Effect.fail(
                    new PluginPackageError("invalid_params", `Plugin ${input.id} has an unreadable package spec`),
                  )
                const owned = (previous?.resources ?? []).flatMap((resource) =>
                  "plugin" in resource && resource.plugin === identity ? (resource.fingerprints ?? []) : [],
                )
                // A modified or unowned entry fails before the network fetch.
                yield* Effect.tryPromise({
                  try: () =>
                    PluginConfig.preflight({
                      file: config,
                      identity,
                      fingerprints: [...owned, PluginConfig.entryFingerprint(spec)],
                    }),
                  catch: (error) => error,
                })
                yield* resolvePlugin({ spec, npm })
              }
              const recordOf = (written: Installer.Written, recovering = false): KiloMarketplaceRpc.Installed => ({
                version: 1,
                registry: input.registry,
                kind: input.kind,
                id: input.id,
                scope: input.scope,
                project: input.scope === "project" ? project : undefined,
                option: input.option,
                ...(written.config ? { config: path.relative(directory(input.scope), written.config) } : {}),
                ...(written.server ? { server: written.server } : {}),
                resources: written.resources?.map(store),
                pending: written.pending?.length ? written.pending.map(store) : undefined,
                recovering: recovering || undefined,
                installedAt: Date.now(),
              })
              const written = yield* Effect.tryPromise({
                try: async (signal) =>
                  Installer.install({
                    entry,
                    skills: path.join(roots(input.scope), "skills"),
                    // The config agent plugin discovers `{agent,agents}/**/*.md` under each config directory.
                    agents: path.join(roots(input.scope), "agents"),
                    config,
                    option: input.option,
                    params: input.params,
                    previous,
                    beforeWrite: async (intent) => {
                      const saved = await Effect.runPromise(save(recordOf(intent, true)).pipe(Effect.result), {
                        signal,
                      })
                      if (Result.isFailure(saved)) throw saved.failure
                    },
                  }),
                catch: (error) => error,
              })
              let record = recordOf(written)
              yield* save(record)
              // Stored pending entries keep the order of written.pending, so progress is tracked by position.
              const retained = record.pending ?? []
              const settled = new Set<number>()
              for (const [index, resource] of (written.pending ?? []).entries()) {
                const cleaned = yield* Effect.tryPromise(() => Installer.cleanup(resource)).pipe(Effect.result)
                if (Result.isFailure(cleaned)) {
                  yield* Effect.logWarning(
                    "Marketplace obsolete resource cleanup failed; retained for retry",
                    resource,
                    cleaned.failure,
                  )
                  continue
                }
                settled.add(index)
                const pending = retained.filter((_, position) => !settled.has(position))
                const next = { ...record, pending: pending.length ? pending : undefined }
                const saved = yield* save(next).pipe(Effect.exit)
                if (Exit.isFailure(saved)) {
                  yield* Effect.logWarning(
                    "Marketplace cleanup progress could not be saved; retained for retry",
                    saved.cause,
                  )
                  break
                }
                record = next
              }
              return yield* Effect.tryPromise({
                try: () => present(record),
                catch: (error) => error,
              })
            }),
            context,
          ),
        uninstall: (input, context) =>
          respond(
            Effect.gen(function* () {
              const key = manifestKey(input)
              const record = yield* read(input)
              if (!record)
                return yield* Effect.fail(
                  new McpError("not_found", `${input.id} was not installed from the marketplace`),
                )
              yield* Effect.tryPromise({
                try: async () => Installer.uninstall(await restore(record)),
                catch: (error) => error,
              })
              yield* storage(
                ctx.storage.remove(key),
                "write_failed",
                "Installation files were removed, but the database record could not be cleared; retry uninstall",
              )
              return {}
            }),
            context,
          ),
      })
      .pipe(Effect.orDie)
  }),
})

function reason(cause: unknown): readonly [keyof typeof KiloMarketplaceRpc.Definition.methods.install.errors, string] {
  if (cause instanceof AggregateError) return [reason(cause.cause ?? cause.errors[0])[0], cause.message]
  if (cause instanceof StorageError) return [cause.reason, cause.message] as const
  if (cause instanceof SkillError)
    return [cause.reason === "conflict" ? "conflict" : "invalid_params", cause.message] as const
  if (cause instanceof AgentError)
    return [cause.reason === "conflict" ? "conflict" : "invalid_params", cause.message] as const
  if (cause instanceof McpError) return [cause.reason, cause.message] as const
  if (cause instanceof MarketplaceConfig.ConfigError) return [cause.reason, cause.message] as const
  if (cause instanceof PluginConfig.PluginConfigError) return [cause.reason, cause.message] as const
  if (cause instanceof PluginPackageError) return [cause.reason, cause.message] as const
  if (cause instanceof Installer.FetchError) return ["fetch_failed", cause.message] as const
  return ["write_failed", cause instanceof Error ? cause.message : String(cause)] as const
}

class StorageError extends Error {
  constructor(
    readonly reason: "fetch_failed" | "write_failed",
    detail: string,
  ) {
    super(detail)
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
