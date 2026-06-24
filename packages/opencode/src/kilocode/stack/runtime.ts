import path from "node:path"
import { createHash } from "node:crypto"
import { lstat } from "node:fs/promises"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Context, Effect, Exit, Layer, Schema, Scope } from "effect"
import { parse } from "jsonc-parser"
import matter from "gray-matter"
import { Config } from "@/config/config"
import { ConfigMCP } from "@/config/mcp"
import { InstanceState } from "@/effect/instance-state"
import { Skill } from "@/skill"
import { Planner } from "./planner"
import { Stack } from "./schema"

export namespace StackRuntime {
  const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
  const Mcp = Schema.Union([ConfigMCP.Info, Schema.Struct({ enabled: Schema.Boolean })])

  export class Error extends Schema.TaggedErrorClass<Error>()("StackRuntimeError", {
    operation: Schema.Literals(["inventory", "fingerprint", "stage", "transaction", "rollback"]),
    resource: Schema.optional(Stack.ResourceRef),
  }) {}

  export interface Transaction {
    readonly install: (input: {
      readonly id: Stack.ResourceID
      readonly source: string
      readonly replace: boolean
      readonly expected?: Stack.Digest
    }) => Effect.Effect<void, Error>
    readonly remove: (id: Stack.ResourceID, expected?: Stack.Digest) => Effect.Effect<void, Error>
    readonly rollback: () => Effect.Effect<void, Error>
    readonly complete: () => Effect.Effect<void, Error>
  }

  export interface Interface {
    readonly inventory: (
      mcp: Readonly<Record<string, unknown>>,
      targets?: ReadonlyArray<Stack.ResourceRef>,
      managed?: ReadonlyArray<Stack.ResourceRef>,
    ) => Effect.Effect<Planner.Inventory, Error>
    readonly fingerprint: (dir: string) => Effect.Effect<Stack.Digest, Error>
    readonly stage: () => Effect.Effect<string, Error, Scope.Scope>
    readonly transaction: () => Effect.Effect<Transaction, Error, Scope.Scope>
  }

  export class Service extends Context.Service<Service, Interface>()("@kilocode/StackRuntime") {}

  function ref(kind: "skill" | "mcp", id: string) {
    return Stack.ResourceRef.make(`${kind}:${id}`)
  }

  function missing(value: unknown) {
    return typeof value === "object" && value !== null && "code" in value && value.code === "ENOENT"
  }

  function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const config = yield* Config.Service
      const skill = yield* Skill.Service

      const roots = Effect.fnUntraced(function* (create: false | "kilo" | "skills", operation: Error["operation"]) {
        const ctx = yield* InstanceState.context
        const worktree = yield* fs.realPath(ctx.worktree).pipe(Effect.mapError(() => new Error({ operation })))
        if (!(yield* fs.isDir(worktree))) return yield* new Error({ operation })

        const child = Effect.fnUntraced(function* (parent: string, name: string, create: boolean) {
          const dir = path.join(parent, name)
          const inspect = Effect.fnUntraced(function* () {
            const info = yield* Effect.tryPromise({ try: () => lstat(dir), catch: (cause) => cause }).pipe(
              Effect.catchIf(missing, () => Effect.succeed(undefined)),
              Effect.mapError(() => new Error({ operation })),
            )
            if (!info) return undefined
            if (info.isSymbolicLink() || !info.isDirectory()) return yield* new Error({ operation })
            const real = yield* fs.realPath(dir).pipe(Effect.mapError(() => new Error({ operation })))
            if (!AppFileSystem.contains(worktree, real) || real !== dir) return yield* new Error({ operation })
            return real
          })
          const current = yield* inspect()
          if (current || !create) return current ?? dir
          yield* fs.ensureDir(dir).pipe(Effect.mapError(() => new Error({ operation })))
          return (yield* inspect()) ?? (yield* new Error({ operation }))
        })

        const kilo = yield* child(worktree, ".kilo", create !== false)
        const skills = yield* child(kilo, "skills", create === "skills")
        return { worktree, kilo, skills }
      })

      const fingerprint = Effect.fn("StackRuntime.fingerprint")(function* (dir: string) {
        const hash = createHash("sha256")
        hash.update("kilo-stack-skill-v1\0")

        const walk: (root: string, rel: string) => Effect.Effect<void, Error> = Effect.fnUntraced(
          function* (root, rel) {
            const current = rel ? path.join(root, ...rel.split("/")) : root
            const entries = yield* fs
              .readDirectoryEntries(current)
              .pipe(Effect.mapError(() => new Error({ operation: "fingerprint" })))
            for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
              const next = rel ? `${rel}/${entry.name}` : entry.name
              const file = path.join(current, entry.name)
              hash.update(entry.type)
              hash.update("\0")
              hash.update(next)
              hash.update("\0")
              if (entry.type === "directory") {
                yield* walk(root, next)
                continue
              }
              if (entry.type === "file") {
                const bytes = yield* fs
                  .readFile(file)
                  .pipe(Effect.mapError(() => new Error({ operation: "fingerprint" })))
                hash.update(bytes)
                hash.update("\0")
                continue
              }
              if (entry.type !== "symlink") continue
              const target = yield* fs
                .readLink(file)
                .pipe(Effect.mapError(() => new Error({ operation: "fingerprint" })))
              hash.update(target)
              hash.update("\0")
            }
          },
        )

        yield* walk(dir, "")
        return Stack.Digest.make(`sha256:${hash.digest("hex")}`)
      })

      const inventory = Effect.fn("StackRuntime.inventory")(function* (
        mcp: Readonly<Record<string, unknown>>,
        targets?: ReadonlyArray<Stack.ResourceRef>,
        managed: ReadonlyArray<Stack.ResourceRef> = [],
      ) {
        const ctx = yield* InstanceState.context
        const safe = yield* roots(false, "inventory")
        const project: Record<string, Stack.Digest> = {}
        const inherited = new Set<Stack.ResourceRef>()
        const selected = new Set(targets ?? Object.keys(mcp).map((id) => ref("mcp", id)))
        const entries = (yield* fs.isDir(safe.skills))
          ? yield* fs
              .readDirectoryEntries(safe.skills)
              .pipe(Effect.mapError(() => new Error({ operation: "inventory" })))
          : []

        for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
          if (entry.type !== "directory" || !slug.test(entry.name) || entry.name.startsWith(".staging-")) continue
          const resource = ref("skill", entry.name)
          if (targets && !selected.has(resource)) continue
          project[resource] = yield* fingerprint(path.join(safe.skills, entry.name)).pipe(
            Effect.mapError(() => new Error({ operation: "inventory", resource })),
          )
        }

        for (const [id, value] of Object.entries(mcp).toSorted(([left], [right]) => left.localeCompare(right))) {
          const resource = ref("mcp", id)
          if (!slug.test(id) || (targets && !selected.has(resource))) continue
          const canonical = yield* Schema.decodeUnknownEffect(Mcp)(value, {
            onExcessProperty: "error",
          }).pipe(Effect.mapError(() => new Error({ operation: "inventory", resource })))
          project[resource] = Planner.fingerprintMcp(canonical)
        }

        const cfg = yield* config.get().pipe(Effect.catchCause(() => new Error({ operation: "inventory" })))
        const dirs = yield* config.directories().pipe(Effect.catchCause(() => new Error({ operation: "inventory" })))
        const skills = yield* skill.all().pipe(Effect.catchCause(() => new Error({ operation: "inventory" })))
        for (const item of skills.toSorted((left, right) => left.name.localeCompare(right.name))) {
          if (!slug.test(item.name)) continue
          const resource = ref("skill", item.name)
          if ((targets && !selected.has(resource)) || project[resource] !== undefined) continue
          if (item.location === "builtin") {
            inherited.add(resource)
            continue
          }
          const file = yield* fs.realPath(item.location).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (file && (yield* fs.isFile(file)) && !AppFileSystem.contains(safe.skills, file)) inherited.add(resource)
        }

        const files = new Set<string>()
        const names = ["kilo.json", "kilo.jsonc", "opencode.json", "opencode.jsonc"]
        const locations = new Set([...dirs, Global.Path.config])
        for (const dir of [ctx.directory, ctx.worktree, Global.Path.home]) {
          locations.add(dir)
          locations.add(path.join(dir, ".kilocode"))
          locations.add(path.join(dir, ".kilo"))
          locations.add(path.join(dir, ".opencode"))
        }
        for (const dir of locations) {
          for (const name of names) files.add(path.join(dir, name))
        }
        files.add(path.join(Global.Path.config, "config.json"))
        const stackFile = path.join(safe.kilo, "kilo.jsonc")

        const declared = new Set<string>()
        const custom = new Set<string>()
        for (const file of files) {
          const raw = yield* fs
            .readFileStringSafe(file)
            .pipe(Effect.mapError(() => new Error({ operation: "inventory" })))
          if (raw === undefined) continue
          const errors: import("jsonc-parser").ParseError[] = []
          const value = yield* Effect.try({
            try: () => parse(raw, errors, { allowTrailingComma: true }) as unknown,
            catch: () => new Error({ operation: "inventory" }),
          })
          if (errors.length > 0) return yield* new Error({ operation: "inventory" })
          if (!record(value)) continue
          if (file !== stackFile && record(value.mcp)) {
            for (const id of Object.keys(value.mcp)) declared.add(id)
          }
          if (record(value.skills) && Array.isArray(value.skills.paths)) {
            for (const item of value.skills.paths) {
              if (typeof item === "string") custom.add(item)
            }
          }
        }

        const probes = new Set<string>(dirs)
        probes.add(Global.Path.config)
        for (const dir of [ctx.directory, ctx.worktree, Global.Path.home]) {
          probes.add(path.join(dir, ".kilo"))
          probes.add(path.join(dir, ".opencode"))
          probes.add(path.join(dir, ".agents"))
          probes.add(path.join(dir, ".claude"))
        }
        for (const value of [...(cfg.skills?.paths ?? []), ...custom]) {
          probes.add(
            value.startsWith("~/") ? path.join(Global.Path.home, value.slice(2)) : path.resolve(ctx.directory, value),
          )
        }
        for (const resource of selected) {
          if (!resource.startsWith("skill:") || project[resource] !== undefined || inherited.has(resource)) continue
          const id = resource.slice("skill:".length)
          for (const root of probes) {
            const candidates = [
              path.join(root, "skills", id, "SKILL.md"),
              path.join(root, "skill", id, "SKILL.md"),
              path.join(root, id, "SKILL.md"),
            ]
            for (const candidate of candidates) {
              const file = yield* fs.realPath(candidate).pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (!file || !(yield* fs.isFile(file)) || AppFileSystem.contains(safe.skills, file)) continue
              const raw = yield* fs
                .readFileString(file)
                .pipe(Effect.mapError(() => new Error({ operation: "inventory", resource })))
              const parsed = yield* Effect.try({
                try: () => matter(raw),
                catch: () => new Error({ operation: "inventory", resource }),
              })
              if (record(parsed.data) && parsed.data.name === id) inherited.add(resource)
            }
          }
        }

        const owned = new Set(managed)
        for (const resource of selected) {
          if (!resource.startsWith("mcp:") || project[resource] !== undefined) continue
          const id = resource.slice("mcp:".length)
          if (declared.has(id) || (!owned.has(resource) && Object.hasOwn(cfg.mcp ?? {}, id))) inherited.add(resource)
        }

        return {
          project: Object.fromEntries(Object.entries(project).toSorted(([left], [right]) => left.localeCompare(right))),
          inherited: [...inherited].toSorted(),
        }
      })

      const stage = Effect.fn("StackRuntime.stage")(function* () {
        const safe = yield* roots("kilo", "stage")
        return yield* fs
          .makeTempDirectoryScoped({ directory: safe.kilo, prefix: ".stack-stage-" })
          .pipe(Effect.mapError(() => new Error({ operation: "stage" })))
      })

      const transaction = Effect.fn("StackRuntime.transaction")(function* () {
        const safe = yield* roots("kilo", "transaction")
        const base = safe.kilo
        const root = safe.skills
        const backup = yield* Effect.acquireRelease(
          fs
            .makeTempDirectory({ directory: base, prefix: ".stack-backup-" })
            .pipe(Effect.mapError(() => new Error({ operation: "transaction" }))),
          (dir) =>
            roots(false, "rollback").pipe(
              Effect.flatMap((current) =>
                current.kilo === base && AppFileSystem.contains(base, dir)
                  ? fs.remove(dir, { recursive: true, force: true })
                  : Effect.void,
              ),
              Effect.catchCause(() => Effect.void),
            ),
        )
        const backups = new Map<string, string>()
        const installed = new Set<string>()
        let closed = false

        const move = Effect.fnUntraced(function* (id: Stack.ResourceID, expected?: Stack.Digest) {
          const resource = ref("skill", id)
          const current = yield* roots(false, "transaction")
          if (current.kilo !== base || current.skills !== root) {
            return yield* new Error({ operation: "transaction", resource })
          }
          const destination = path.join(root, id)
          if (backups.has(id) || !(yield* fs.existsSafe(destination))) return undefined
          if (expected !== undefined && (yield* fingerprint(destination)) !== expected) {
            return yield* new Error({ operation: "transaction", resource })
          }
          const saved = path.join(backup, id)
          yield* fs
            .rename(destination, saved)
            .pipe(Effect.mapError(() => new Error({ operation: "transaction", resource })))
          backups.set(id, saved)
          return undefined
        })

        const install = Effect.fn("StackRuntime.Transaction.install")(function* (input: {
          readonly id: Stack.ResourceID
          readonly source: string
          readonly replace: boolean
          readonly expected?: Stack.Digest
        }) {
          const resource = ref("skill", input.id)
          const current = yield* roots("skills", "transaction")
          if (current.kilo !== base || current.skills !== root) {
            return yield* new Error({ operation: "transaction", resource })
          }
          const destination = path.join(root, input.id)
          const exists = yield* fs.existsSafe(destination)
          if (exists && !input.replace) return yield* new Error({ operation: "transaction", resource })
          if (exists) yield* move(input.id, input.expected)
          const source = yield* fs
            .realPath(input.source)
            .pipe(Effect.mapError(() => new Error({ operation: "transaction", resource })))
          if (!AppFileSystem.contains(current.worktree, source) || !(yield* fs.isDir(source))) {
            return yield* new Error({ operation: "transaction", resource })
          }
          yield* fs
            .rename(source, destination)
            .pipe(Effect.mapError(() => new Error({ operation: "transaction", resource })))
          installed.add(input.id)
          return undefined
        })

        const remove = Effect.fn("StackRuntime.Transaction.remove")(function* (
          id: Stack.ResourceID,
          expected?: Stack.Digest,
        ) {
          yield* move(id, expected)
          return undefined
        })

        const rollback = Effect.fn("StackRuntime.Transaction.rollback")(function* () {
          if (closed) return undefined
          const current = yield* roots(false, "rollback")
          if (current.kilo !== base || current.skills !== root) return yield* new Error({ operation: "rollback" })
          const exits = yield* Effect.forEach([...installed].toSorted().reverse(), (id) =>
            fs.remove(path.join(root, id), { recursive: true, force: true }).pipe(Effect.exit),
          )
          const restored = yield* Effect.forEach(
            [...backups.entries()].toSorted(([left], [right]) => right.localeCompare(left)),
            ([id, saved]) => fs.rename(saved, path.join(root, id)).pipe(Effect.exit),
          )
          const cleaned = yield* fs.remove(backup, { recursive: true, force: true }).pipe(Effect.exit)
          if ([...exits, ...restored, cleaned].some(Exit.isFailure)) {
            return yield* new Error({ operation: "rollback" })
          }
          closed = true
          return undefined
        })

        const complete = Effect.fn("StackRuntime.Transaction.complete")(function* () {
          if (closed) return undefined
          const current = yield* roots(false, "transaction")
          if (current.kilo !== base) return yield* new Error({ operation: "transaction" })
          closed = true
          yield* fs
            .remove(backup, { recursive: true, force: true })
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning("Stack backup cleanup failed").pipe(Effect.annotateLogs({ error })),
              ),
            )
          return undefined
        })

        yield* Effect.addFinalizer(() =>
          rollback().pipe(
            Effect.catch((error) =>
              Effect.logError("Stack transaction rollback failed").pipe(Effect.annotateLogs({ error })),
            ),
          ),
        )
        return { install, remove, rollback, complete } satisfies Transaction
      })

      return Service.of({ inventory, fingerprint, stage, transaction })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
  )
}
