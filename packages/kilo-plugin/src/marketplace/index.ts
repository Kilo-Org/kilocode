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
        // The scope-local journal survives a reset database or a moved project, and precedes every mutation.
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

    const manifestKey = (input: { registry: string; kind: string; id: string; scope: KiloMarketplaceRpc.Scope }) =>
      ["installed", input.registry, input.kind, input.id, input.scope, input.scope === "project" ? project : ""].join(
        ":",
      )

    // Only the curated Kilo marketplace is on by default: the other registries list community content nobody at
    // Kilo reviewed, so a user turns them on (`registries.set`). The choice is global, in plugin storage.
    const enabled = storage(
      ctx.storage.get("registries"),
      "fetch_failed",
      "Couldn't read enabled marketplace registries",
    ).pipe(
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
        if (!refresh && cached && Date.now() - cached.at < CATALOG_TTL) return { entries: cached.entries }
        const fetched = yield* Effect.tryPromise({ try: () => registry.list(kind, search), catch: message }).pipe(
          Effect.result,
        )
        if (Result.isSuccess(fetched)) {
          cache(key, Date.now(), fetched.success)
          if (!search)
            yield* storage(
              ctx.storage.set(`catalog:${key}`, JSON.stringify(fetched.success)),
              "write_failed",
              "Couldn't cache marketplace catalog",
            ).pipe(Effect.ignore)
          return { entries: fetched.success }
        }
        const failure = `Couldn't load ${registry.name}: ${fetched.failure}`
        if (cached) return { entries: cached.entries, failure }
        const stored = search
          ? undefined
          : yield* storage(
              ctx.storage.get(`catalog:${key}`),
              "fetch_failed",
              "Couldn't read cached marketplace catalog",
            ).pipe(Effect.orElseSucceed(() => undefined))
        const snapshot = typeof stored === "string" ? Option.getOrUndefined(decodeSnapshot(stored)) : undefined
        if (!snapshot) {
          return yield* Effect.fail(failure)
        }
        return { entries: cache(key, 0, snapshot), failure }
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
        const entries = results.flatMap((result) => (Result.isSuccess(result) ? result.success.entries : []))
        const failures = results.flatMap((result, index) =>
          Result.isFailure(result)
            ? [result.failure]
            : result.success.failure
              ? [{ registry: active[index].id, message: result.success.failure }]
              : [],
        )
        if (failures.length > 0 && failures.length === results.length && entries.length === 0) {
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

    const local = (scope: KiloMarketplaceRpc.Scope) =>
      Effect.tryPromise({
        try: () => readLocal(roots(scope), directory(scope), scope),
        catch: (error) => new StorageError("fetch_failed", message(error)),
      })

    const read = (input: { registry: string; kind: string; id: string; scope: KiloMarketplaceRpc.Scope }) =>
      Effect.gen(function* () {
        const stored = yield* storage(
          ctx.storage.get(manifestKey(input)),
          "fetch_failed",
          "Couldn't read marketplace installation",
        )
        const decoded = stored === undefined ? undefined : decodeRecord(stored, manifestKey(input))
        const records = yield* local(input.scope)
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
          if (decoded.scope === "project" && decoded.project !== project) {
            // New records also travel with the project. Remove only the stale database index, never its files.
            if (
              decoded.resources &&
              decoded.project &&
              !(yield* Effect.tryPromise({
                try: () => directoryExists(decoded.project!),
                catch: (error) => new StorageError("fetch_failed", message(error)),
              }))
            ) {
              yield* storage(ctx.storage.remove(entry.key), "write_failed", "Couldn't remove stale marketplace index")
            }
            continue
          }
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
              Effect.mapError((error) =>
                error instanceof StorageError ? error : new StorageError("fetch_failed", error),
              ),
            ),
            context,
          ),
        registries: (_, context) => respond(registryInfo, context),
        "registries.set": (input, context) =>
          respond(
            Effect.gen(function* () {
              if (!registries.some((registry) => registry.id === input.id)) {
                return yield* Effect.fail(new McpError("not_found", `Unknown registry ${input.id}`))
              }
              const on = yield* enabled
              if (input.enabled) on.add(input.id)
              else on.delete(input.id)
              yield* storage(
                ctx.storage.set("registries", [...on]),
                "write_failed",
                "Couldn't save enabled marketplace registries",
              )
              return yield* registryInfo
            }),
            context,
          ),
        installed: (_, context) => respond(installed, context),
        install: (input, context) =>
          respond(
            Effect.gen(function* () {
              if (input.kind === "agent") {
                return yield* Effect.fail(new StorageError("unsupported", "Installing agents is not supported yet"))
              }
              const on = yield* enabled
              if (!on.has(input.registry)) {
                return yield* Effect.fail(
                  new McpError("not_found", `The ${input.registry} registry is turned off; enable it first`),
                )
              }
              const entry = yield* lookup(input.registry, input.kind, input.id).pipe(
                Effect.mapError((error) =>
                  error instanceof StorageError ? error : new StorageError("fetch_failed", error),
                ),
              )
              if (!entry) {
                return yield* Effect.fail(
                  new McpError("not_found", `No ${input.kind} ${input.id} in ${input.registry}`),
                )
              }
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
                    config: await configFile(
                      input.scope === "global" ? global.config : project,
                      input.scope === "global",
                    ),
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
              if (!record) {
                return yield* Effect.fail(
                  new McpError("not_found", `${input.id} was not installed from the marketplace`),
                )
              }
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

// Maps an install or uninstall failure to an error name of the contract.
function reason(cause: unknown): readonly [keyof typeof KiloMarketplaceRpc.Definition.methods.install.errors, string] {
  if (cause instanceof AggregateError) {
    // Cleanup details supplement the operation's primary failure instead of replacing its declared error kind.
    return [reason(cause.cause ?? cause.errors[0])[0], cause.message]
  }
  if (cause instanceof StorageError) return [cause.reason, cause.message] as const
  if (cause instanceof SkillError)
    return [cause.reason === "conflict" ? "conflict" : "invalid_params", cause.message] as const
  if (cause instanceof McpError) return [cause.reason, cause.message] as const
  if (cause instanceof Installer.FetchError) return ["fetch_failed", cause.message] as const
  return ["write_failed", cause instanceof Error ? cause.message : String(cause)] as const
}

class StorageError extends Error {
  constructor(
    readonly reason: "fetch_failed" | "write_failed" | "unsupported",
    detail: string,
  ) {
    super(detail)
  }
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

async function readLocal(root: string, directory: string, scope: KiloMarketplaceRpc.Scope) {
  const files = await fs.readdir(path.join(root, ".marketplace", "installed")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []
    throw error
  })
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
        const rebase = (original: string) => {
          const relative = path.relative(stored.directory, original)
          if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
            throw new Error(`Marketplace recovery path is outside its installation scope: ${target}`)
          return path.join(directory, relative)
        }
        const resource = (entry: KiloMarketplaceRpc.Resource): KiloMarketplaceRpc.Resource =>
          "path" in entry ? { ...entry, path: rebase(entry.path) } : { ...entry, config: rebase(entry.config) }
        return {
          ...stored.record,
          project: scope === "project" ? directory : undefined,
          paths: stored.record.paths.map(rebase),
          config: stored.record.config ? rebase(stored.record.config) : undefined,
          resources: stored.record.resources?.map(resource),
          pending: stored.record.pending?.map(resource),
        }
      }),
  )
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
