import { define } from "@opencode/plugin/effect/plugin"
import type { RpcCallContext } from "@opencode/plugin/effect/rpc"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { ProjectID } from "@opencode/schema/project-id"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { Global } from "@opencode/util/global"
import fs from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { Effect, Exit, Option, Result, Schema, Scope } from "effect"
import { KiloMarketplaceRegistry } from "./kilo"
import { Installer } from "./installer"
import { McpError, configFile, resolveFile, serverName } from "./mcp"
import type { Entry } from "./registry"
import { SkillError } from "./skill"

const CATALOG_TTL = 10 * 60 * 1000
const decodeInstalled = Schema.decodeUnknownOption(Schema.fromJsonString(KiloMarketplaceRpc.Installed))
const decodeLocal = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ directory: Schema.String, record: KiloMarketplaceRpc.Installed })),
)
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

    const save = (record: KiloMarketplaceRpc.Installed) =>
      Effect.gen(function* () {
        // Scope-local intent precedes every mutation and survives a reset database or a moved project.
        yield* Effect.tryPromise({
          try: () => writeLocal(roots(record.scope), directory(record.scope), record),
          catch: (error) =>
            new StorageError("write_failed", `Couldn't save marketplace recovery record: ${message(error)}`),
        })
        yield* storage(
          ctx.storage.set(manifestKey(record), JSON.stringify(record)),
          "write_failed",
          "Couldn't save marketplace installation; the recovery record was retained. Retry install or uninstall",
        )
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
        const key = `${registry.id}:${kind}:`
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
                    ctx.storage.set(`catalog:${key}`, JSON.stringify(fetched.success)),
                    "write_failed",
                    "Couldn't cache marketplace catalog",
                  ).pipe(Effect.ignore)
                  return { entries: fetched.success }
                }
                const failure = `Couldn't load ${registry.name}: ${fetched.failure}`
                if (cached) return { entries: cached.entries, failure }
                const stored = yield* storage(
                  ctx.storage.get(`catalog:${key}`),
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

    const local = (scope: KiloMarketplaceRpc.Scope, migrate = true) =>
      Effect.gen(function* () {
        const entries = yield* Effect.tryPromise({
          try: (signal) =>
            readLocal(roots(scope), directory(scope), scope, (record) =>
              Effect.runPromise(
                storage(
                  ctx.storage.get(manifestKey(record)),
                  "fetch_failed",
                  "Couldn't verify external config ownership",
                ).pipe(
                  Effect.map((value) => (value === undefined ? undefined : decodeRecord(value, manifestKey(record)))),
                ),
                { signal },
              ),
            ),
          catch: (error) => new StorageError("fetch_failed", message(error)),
        })
        const records = entries.map((entry) => entry.record)
        if (!migrate) return records
        for (const entry of entries) {
          const key = manifestKey(entry.record)
          const retirementKey = `retiring:${key}`
          if (manifestKey(entry.original) !== key) {
            yield* storage(
              ctx.storage.set(key, JSON.stringify(entry.record)),
              "write_failed",
              "Couldn't migrate marketplace ownership",
            )
            const copied =
              entry.original.project &&
              (yield* Effect.tryPromise({
                try: () => directoryExists(entry.original.project!),
                catch: (error) => new StorageError("fetch_failed", message(error)),
              }))
            // Retirement intent is separate so rewriting the journal cannot erase a failed cleanup's identity.
            if (!copied)
              yield* storage(
                ctx.storage.set(retirementKey, JSON.stringify(entry.original)),
                "write_failed",
                "Couldn't save marketplace ownership retirement",
              )
            yield* Effect.tryPromise({
              try: () => writeLocal(roots(scope), directory(scope), entry.record),
              catch: (error) =>
                new StorageError("write_failed", `Couldn't migrate marketplace journal: ${message(error)}`),
            })
          }
          const retiring = yield* storage(
            ctx.storage.get(retirementKey),
            "fetch_failed",
            "Couldn't read marketplace ownership retirement",
          )
          if (retiring === undefined) continue
          yield* storage(
            ctx.storage.remove(manifestKey(decodeRecord(retiring, retirementKey))),
            "write_failed",
            "Couldn't remove stale marketplace index",
          )
          yield* storage(
            ctx.storage.remove(retirementKey),
            "write_failed",
            "Couldn't clear marketplace ownership retirement; retry install or uninstall",
          )
        }
        return records
      })

    const read = (
      input: { registry: string; kind: string; id: string; scope: KiloMarketplaceRpc.Scope },
      migrate = true,
    ) =>
      Effect.gen(function* () {
        const stored = yield* storage(
          ctx.storage.get(manifestKey(input)),
          "fetch_failed",
          "Couldn't read marketplace installation",
        )
        const decoded = stored === undefined ? undefined : decodeRecord(stored, manifestKey(input))
        const records = yield* local(input.scope, migrate)
        return records.find((record) => manifestKey(record) === manifestKey(input)) ?? decoded
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
          const decoded = decodeRecord(entry.value, entry.key)
          if (decoded.scope === "project" && decoded.project !== project) continue
          records.push(decoded)
        }
        after = scanned.next
      } while (after !== undefined)
      const disk = [...(yield* local("global")), ...(yield* local("project"))]
      const merged = [...new Map([...records, ...disk].map((record) => [manifestKey(record), record])).values()]
      return yield* Effect.forEach(merged, (record) =>
        Effect.tryPromise({
          try: async () => ({ ...record, ...(await Installer.inspect(record)) }),
          catch: (error) => new StorageError("fetch_failed", `Couldn't inspect ${record.id}: ${message(error)}`),
        }),
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
              const previous = yield* read(input, false)
              return yield* Effect.tryPromise({
                try: async () => ({
                  ...Installer.preview({ entry, option: input.option, params: input.params }),
                  config: await configFile(directory(input.scope), input.scope === "global", [
                    ...(previous?.resources ?? []),
                    ...(previous?.pending ?? []),
                  ]),
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
              const previous = yield* read(input)
              const recordOf = (written: Installer.Written, recovering = false): KiloMarketplaceRpc.Installed => ({
                registry: input.registry,
                kind: input.kind,
                id: input.id,
                scope: input.scope,
                project: input.scope === "project" ? project : undefined,
                ...written,
                recovering: recovering || undefined,
                installedAt: Date.now(),
              })
              const written = yield* Effect.tryPromise({
                try: async (signal) =>
                  Installer.install({
                    entry,
                    skills: path.join(roots(input.scope), "skills"),
                    config:
                      input.kind === "skill"
                        ? path.join(directory(input.scope), KiloConfigFiles.newFile)
                        : await configFile(directory(input.scope), input.scope === "global", [
                            ...(previous?.resources ?? []),
                            ...(previous?.pending ?? []),
                          ]),
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
                try: async () => ({ ...record, ...(await Installer.inspect(record)) }),
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
              yield* Effect.tryPromise({ try: () => Installer.uninstall(record), catch: (error) => error })
              yield* storage(
                ctx.storage.remove(key),
                "write_failed",
                "Installation files were removed, but the database record could not be cleared; retry uninstall",
              )
              yield* Effect.tryPromise({
                try: () => fs.rm(localFile(roots(input.scope), record), { force: true }),
                catch: (error) => error,
              })
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
  if (cause instanceof McpError) return [cause.reason, cause.message] as const
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

async function directoryExists(directory: string) {
  return fs.stat(directory).then(
    (entry) => entry.isDirectory(),
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false
      throw error
    },
  )
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function decodeRecord(value: unknown, key: string) {
  const decoded = typeof value === "string" ? decodeInstalled(value) : Option.none()
  if (Option.isNone(decoded))
    throw new StorageError(
      "fetch_failed",
      `Invalid marketplace record ${key}; restore its recovery metadata or repair the record before continuing. No files were removed.`,
    )
  return decoded.value
}

function localFile(root: string, record: Pick<KiloMarketplaceRpc.Installed, "registry" | "kind" | "id">) {
  return path.join(
    root,
    ".marketplace",
    "installed",
    `${new Bun.CryptoHasher("sha256").update(JSON.stringify([record.registry, record.kind, record.id])).digest("hex")}.json`,
  )
}

async function writeLocal(root: string, directory: string, record: KiloMarketplaceRpc.Installed) {
  const file = localFile(root, record)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify({ directory, record }), { mode: 0o600, flag: "wx" })
    await fs.rename(temporary, file)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

async function readLocal(
  root: string,
  directory: string,
  scope: KiloMarketplaceRpc.Scope,
  trusted: (record: KiloMarketplaceRpc.Installed) => Promise<KiloMarketplaceRpc.Installed | undefined>,
) {
  const files = await fs.readdir(path.join(root, ".marketplace", "installed")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  for (const candidate of scope === "project" ? [root, path.join(root, "skills")] : [path.join(root, "skills")]) {
    const info = await fs.lstat(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (info?.isSymbolicLink()) throw new Error(`Unsafe marketplace recovery directory: ${candidate}`)
  }
  return Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        const target = path.join(root, ".marketplace", "installed", file)
        const decoded = decodeLocal(await fs.readFile(target, "utf8"))
        if (Option.isNone(decoded))
          throw new Error(
            `Invalid marketplace recovery record ${target}; restore or repair this file before continuing`,
          )
        const stored = decoded.value
        if (stored.record.scope !== scope || path.basename(localFile(root, stored.record)) !== file)
          throw new Error(`Marketplace recovery record does not match its scope or filename: ${target}`)
        const rebase = (original: string, kind: "skill" | "config") => {
          const relative = path.relative(stored.directory, original)
          if (
            !path.isAbsolute(stored.directory) ||
            !path.isAbsolute(original) ||
            relative === ".." ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)
          )
            throw new Error(`Marketplace recovery path is outside its installation scope: ${target}`)
          const rebased = path.join(directory, relative)
          const allowed =
            kind === "skill"
              ? path.dirname(rebased) === path.join(root, "skills") &&
                /^[a-z0-9][a-z0-9._-]*$/i.test(path.basename(rebased))
              : KiloConfigFiles.writeCandidates(directory, scope === "global").includes(rebased)
          if (!allowed) throw new Error(`Marketplace recovery path is outside its installation scope: ${target}`)
          return rebased
        }
        const configs = KiloConfigFiles.writeCandidates(await resolveFile(directory), scope === "global")
        const originals = KiloConfigFiles.writeCandidates(await resolveFile(stored.directory), scope === "global")
        const ownership = async (
          entry: Extract<KiloMarketplaceRpc.Resource, { config: string }>,
          destination: string,
        ) => {
          const owned = await trusted(stored.record)
          const resource = [...(owned?.resources ?? []), ...(owned?.pending ?? [])].find(
            (resource) =>
              "config" in resource &&
              resource.config === path.join(stored.directory, path.relative(directory, entry.config)) &&
              resource.server === entry.server &&
              resource.target === destination,
          )
          if (!resource || !("config" in resource))
            throw new Error(`Marketplace recovery config target has no machine-local ownership: ${entry.config}`)
          return { ...entry, target: destination, fingerprints: resource.fingerprints }
        }
        const external = async (entry: Extract<KiloMarketplaceRpc.Resource, { config: string }>) => {
          const destination = await resolveFile(entry.config)
          if (scope === "global" || configs.includes(destination)) {
            // Only scope relocation may rebase ownership, never a changed config symlink.
            const rebased =
              stored.directory !== directory && entry.target && originals.includes(entry.target)
                ? { ...entry, target: configs[originals.indexOf(entry.target)] }
                : entry
            if (scope === "project" && rebased.target && !configs.includes(rebased.target))
              return ownership(rebased, rebased.target)
            return rebased
          }
          return ownership(entry, destination)
        }
        const resource = async (entry: KiloMarketplaceRpc.Resource): Promise<KiloMarketplaceRpc.Resource> =>
          "path" in entry
            ? { ...entry, path: rebase(entry.path, "skill") }
            : external({ ...entry, config: rebase(entry.config, "config") })
        const config = stored.record.config ? rebase(stored.record.config, "config") : undefined
        if (config) await external({ config, server: stored.record.server ?? serverName(stored.record.id) })
        return {
          original: stored.record,
          record: {
            ...stored.record,
            project: scope === "project" ? directory : undefined,
            paths: stored.record.paths.map((entry) => rebase(entry, "skill")),
            config,
            resources: stored.record.resources ? await Promise.all(stored.record.resources.map(resource)) : undefined,
            pending: stored.record.pending ? await Promise.all(stored.record.pending.map(resource)) : undefined,
          },
        }
      }),
  )
}
