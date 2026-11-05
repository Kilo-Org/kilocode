import { KiloConfigWriter } from "@opencode/core/kilocode/config/write"
import type { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Layer } from "effect"
import { parse } from "jsonc-parser"

// The `indexing` key of the global and the project config file, read and written in place. The project file is the
// one of the Location directory; the global file is in the global config directory.
export interface Targets {
  readonly global: string
  readonly project: string
}

export const make = Effect.fn("IndexingSettings.make")(function* (targets: Targets) {
  const fs = yield* FSUtil.Service
  const writer = yield* Effect.gen(function* () {
    return yield* KiloConfigWriter.Service
  }).pipe(Effect.provide(KiloConfigWriter.layer().pipe(Layer.provide(Layer.succeed(FSUtil.Service, fs)))))
  const target = (scope: KiloIndexingRpc.Scope) =>
    writer.target(scope === "global" ? { directory: targets.global, global: true } : { directory: targets.project })

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
    if (!indexing || typeof indexing !== "object" || Array.isArray(indexing)) return {}
    return indexing as KiloIndexingRpc.Config
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
