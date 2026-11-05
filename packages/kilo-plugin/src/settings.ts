import { Config } from "@opencode/core/config"
import { systemDirectory } from "@opencode/core/kilocode/config/discovery"
import { KiloConfigWriter } from "@opencode/core/kilocode/config/write"
import { define } from "@opencode/plugin/effect/plugin"
import { KiloSettingsRpc } from "@opencode/schema/kilocode/settings"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { Context, Effect, Layer, Option, type Scope as EffectScope } from "effect"
import path from "node:path"

// The `kilocode.settings` RPC: the write half of the v1 `PATCH /config/overlay`. It resolves the global or project
// target to the highest-precedence document the reader loads, guards a stale revision, and applies the edit live. The
// upstream config route carries only `shell`, so clients write Kilo keys through this RPC.

type Edit = { readonly path: readonly string[]; readonly value: unknown }
type Document = { readonly path: string; readonly info: unknown }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

/** Whether `parts` resolves to a defined value in a document, for the project-wide unset scan. */
function hasPath(input: unknown, parts: readonly string[]) {
  let current: unknown = input
  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) return false
    current = current[part]
  }
  return true
}

/** Expand a `set` object into leaf edits; a `null` value removes, as in the v1 overlay patch. */
function expandSet(prefix: readonly string[], value: unknown, edits: Edit[]) {
  if (value === null) return edits.push({ path: prefix, value: undefined })
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) expandSet([...prefix, key], child, edits)
    return
  }
  edits.push({ path: prefix, value })
}

export const KiloSettingsPlugin = define<FSUtil.Service | Global.Service | EffectScope.Scope>({
  id: "kilocode.settings",
  effect: Effect.fn("KiloSettingsPlugin")(function* (ctx) {
    const config = yield* Effect.serviceOption(Config.Service)
    if (Option.isNone(config)) return yield* Effect.die(new Error("Kilo settings require location config"))
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    // The writer is a Context service; build it once so its conflict lock spans the plugin's lifetime. It writes
    // under the config roots the host already watches, so the watcher carries the reload and the hook stays unset.
    const writer = Context.get(yield* Layer.build(KiloConfigWriter.layer()), KiloConfigWriter.Service)

    const directory = ctx.location.directory
    const globalDirectory = global.config
    const systemDir = systemDirectory()

    const writeTarget = (scope: KiloSettingsRpc.Scope) => ({
      directory: scope === "global" ? globalDirectory : directory,
      global: scope === "global",
    })

    const isConfigFile = (file: string) => KiloConfigFiles.names.includes(path.basename(file))
    const inGlobal = (file: string) => FSUtil.contains(globalDirectory, file)
    const inSystem = (file: string) => FSUtil.contains(systemDir, file)
    const inScope = (scope: KiloSettingsRpc.Scope, file: string) =>
      scope === "global" ? inGlobal(file) : !inGlobal(file) && !inSystem(file)

    // The config documents the reader loads for the scope, lowest priority first. Paths are canonicalized so a
    // repository-controlled symlink cannot move a project write outside the project (for example into the global
    // config): a document that resolves outside the scope is dropped, and the write guard below rejects a target.
    const scopeDocuments = (scope: KiloSettingsRpc.Scope) =>
      Effect.gen(function* () {
        const entries = yield* config.value.entries()
        const documents = yield* Effect.forEach(entries, (entry) =>
          Effect.gen(function* () {
            if (entry.type !== "document" || entry.path === undefined || !isConfigFile(entry.path)) return []
            const file = yield* fs.resolve(entry.path)
            return inScope(scope, file) ? [{ path: file, info: entry.info }] : []
          }),
        )
        return documents.flat() satisfies Document[]
      })

    // The reader's effective document for the scope wins, so a write is never shadowed by a nearer file it loads.
    const resolveFile = (scope: KiloSettingsRpc.Scope) =>
      Effect.gen(function* () {
        const documents = yield* scopeDocuments(scope)
        const fallback = yield* writer.target(writeTarget(scope))
        return { file: yield* fs.resolve(documents.at(-1)?.path ?? fallback), documents }
      })

    const readTarget = (scope: KiloSettingsRpc.Scope) =>
      Effect.gen(function* () {
        const { file } = yield* resolveFile(scope)
        const revision = yield* writer.revision(file)
        return {
          scope,
          path: file,
          ...(revision ? { revision: revision.hash } : {}),
          exists: revision !== undefined,
        } satisfies KiloSettingsRpc.Target
      })

    yield* ctx.rpc
      .register(KiloSettingsRpc.Definition, {
        target: (input, context) =>
          readTarget(input.scope).pipe(
            Effect.catchTag("KiloConfigWriterError", (error) =>
              Effect.fail(context.error("failed", error.message, { message: error.message })),
            ),
          ),
        write: (input, context) =>
          Effect.gen(function* () {
            const scope = input.scope
            const { file, documents } = yield* resolveFile(scope)
            if (!inScope(scope, file))
              return yield* Effect.fail(
                context.error("failed", `${file} is outside the ${scope} config scope`, { message: `Outside scope: ${file}` }),
              )
            const before = yield* writer.revision(file)
            const current: KiloSettingsRpc.Target = {
              scope,
              path: file,
              ...(before ? { revision: before.hash } : {}),
              exists: before !== undefined,
            }
            const expected = input.expected
            // The target guard runs before any write so the conflict carries the current file, not a stale one.
            if (expected && expected.path !== file)
              return yield* Effect.fail(
                context.error("conflict", `The ${scope} config target changed`, {
                  code: "target-changed" as const,
                  target: current,
                }),
              )
            if (expected && before?.hash !== expected.revision)
              return yield* Effect.fail(
                context.error("conflict", `${file} changed since the caller read it`, {
                  code: "revision-conflict" as const,
                  target: current,
                }),
              )

            const edits: Edit[] = []
            for (const [key, value] of Object.entries(input.set ?? {})) expandSet([key], value, edits)
            for (const parts of input.unset ?? []) {
              if (parts.length === 0) continue
              edits.push({ path: parts, value: undefined })
            }
            const removals = edits.filter((edit) => edit.value === undefined).map((edit) => edit.path)
            // A removal on a file that does not exist has nothing to remove; skip it so the RPC never creates an
            // empty file for a no-op, as the v1 overlay did. A project removal may still reach another document.
            const applicable = edits.filter((edit) => edit.value !== undefined || before !== undefined)
            if (applicable.length === 0 && !(scope === "project" && removals.length > 0))
              return { scope, target: current, changed: false }

            const guard = (error: KiloConfigWriter.WriteError) =>
              Effect.gen(function* () {
                if (error.reason !== "conflict")
                  return yield* Effect.fail(
                    error.reason === "invalid"
                      ? context.error("invalid", error.message, { message: error.message, path: error.file })
                      : context.error("failed", error.message, { message: error.message }),
                  )
                const latest = yield* writer.revision(error.file)
                return yield* Effect.fail(
                  context.error("conflict", error.message, {
                    code: "revision-conflict" as const,
                    target: {
                      scope,
                      path: error.file,
                      ...(latest ? { revision: latest.hash } : {}),
                      exists: latest !== undefined,
                    },
                  }),
                )
              })

            // The first write carries the caller's guard; later edits carry the previous write's revision, so a
            // concurrent external change still fails instead of clobbering.
            let revision = expected?.revision
            for (const edit of applicable) {
              const result = yield* writer
                .write({ target: { ...writeTarget(scope), file }, path: edit.path, value: edit.value, ...(revision ? { expectedRevision: revision } : {}) })
                .pipe(Effect.catchTag("KiloConfigWriterError", guard))
              revision = result.revision
            }

            // Privacy-mode style keys are on when any document sets them, so a project unset must reach every project
            // document that sets the path, not only the resolved target. The target was handled above.
            let unsetOthers = false
            if (scope === "project") {
              for (const parts of removals) {
                for (const document of documents) {
                  if (document.path === file || !hasPath(document.info, parts)) continue
                  yield* writer
                    .write({
                      target: { directory: path.dirname(document.path), global: false, file: document.path },
                      path: parts,
                      value: undefined,
                    })
                    .pipe(
                      Effect.catchTag("KiloConfigWriterError", (error) =>
                        error.reason === "conflict"
                          ? Effect.die(error)
                          : Effect.fail(context.error("failed", error.message, { message: error.message })),
                      ),
                    )
                  unsetOthers = true
                }
              }
            }

            const after = yield* writer.revision(file)
            return {
              scope,
              target: {
                scope,
                path: file,
                ...(after ? { revision: after.hash } : {}),
                exists: after !== undefined,
              },
              changed: unsetOthers || (after?.hash ?? undefined) !== (before?.hash ?? undefined),
            }
          }).pipe(
            Effect.catchTag("KiloConfigWriterError", (error) =>
              Effect.fail(context.error("failed", error.message, { message: error.message })),
            ),
          ),
      })
      .pipe(Effect.orDie)
  }),
})
