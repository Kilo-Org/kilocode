import { KiloConfigWriter } from "@opencode/core/kilocode/config/write"
import { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Layer, Option, Schema } from "effect"
import { parse } from "jsonc-parser"

// The `indexing` key of the global and the project config file, read and written in place. The project file is the
// one of the Location directory; the global file is in the global config directory.
export interface Targets {
  readonly global: string
  readonly project: string
  /** Runs after each successful write, so the saved settings apply. */
  readonly reload?: () => Promise<void>
}

export const make = Effect.fn("IndexingSettings.make")(function* (targets: Targets) {
  const fs = yield* FSUtil.Service
  const writer = yield* Effect.gen(function* () {
    return yield* KiloConfigWriter.Service
  }).pipe(
    Effect.provide(
      KiloConfigWriter.layer({
        reload: Effect.suspend(() => Effect.promise(() => targets.reload?.() ?? Promise.resolve())),
      }).pipe(Layer.provide(Layer.succeed(FSUtil.Service, fs))),
    ),
  )
  const target = (scope: KiloIndexingRpc.Scope) =>
    writer.target(scope === "global" ? { directory: targets.global, global: true } : { directory: targets.project })

  // The key is decoded as one object, like the config policy does for the engine: when one field is invalid, the
  // answer is empty, the same settings the engine uses, instead of failing the whole `config` call.
  const read = Effect.fn("IndexingSettings.read")(function* (scope: KiloIndexingRpc.Scope) {
    const file = yield* target(scope)
    const text = yield* Effect.promise(() =>
      Bun.file(file)
        .text()
        .catch(() => ""),
    )
    const document: unknown = parse(text, [], { allowTrailingComma: true })
    if (!document || typeof document !== "object" || Array.isArray(document)) return {}
    const indexing = (document as Record<string, unknown>).indexing
    if (indexing === undefined) return {}
    const decoded = Schema.decodeUnknownOption(KiloIndexingRpc.Config)(indexing)
    if (Option.isSome(decoded)) return decoded.value
    yield* Effect.logWarning("ignored invalid indexing settings", { file })
    return {}
  })

  const write = Effect.fn("IndexingSettings.write")(function* (
    scope: KiloIndexingRpc.Scope,
    config: KiloIndexingRpc.Config,
  ) {
    yield* writer.write({
      target: scope === "global" ? { directory: targets.global, global: true } : { directory: targets.project },
      path: ["indexing"],
      value: Object.keys(config).length > 0 ? config : undefined,
    })
  })

  return { read, write }
})
