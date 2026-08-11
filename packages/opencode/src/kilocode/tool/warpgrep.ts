import { RipgrepBinary } from "@opencode-ai/core/ripgrep/binary"
import { Cause, Effect, Exit } from "effect"

declare global {
  const KILO_MORPH_RIPGREP_MANAGED: boolean
}

const active = typeof KILO_MORPH_RIPGREP_MANAGED === "boolean" && KILO_MORPH_RIPGREP_MANAGED

export const prepare = Effect.gen(function* () {
  const binary = yield* RipgrepBinary.Service
  return (query: string) =>
    Effect.gen(function* () {
      const ready = yield* binary.filepath.pipe(Effect.asVoid, Effect.exit)
      if (Exit.isSuccess(ready)) return

      const error = Cause.squash(ready.cause)
      const message = error instanceof Error ? error.message : String(error)
      return {
        title: `Codebase Search: ${query}`,
        output: `Codebase search unavailable: ${message}`,
        metadata: { count: 0 },
      }
    })
})

export const load = (enabled: boolean) =>
  enabled ? prepare : Effect.succeed((_query: string) => Effect.succeed(undefined))

export const provision = load(active)
