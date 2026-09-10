import { define, type Plugin } from "@opencode-ai/plugin/effect/plugin"
import { GenerationRpc } from "@opencode-ai/schema/kilocode/generation"
import { Effect } from "effect"

export const GENERATION_PLUGIN_ID = "kilocode.generation"

export function createGenerationPlugin(): Plugin {
  return define({
    id: GENERATION_PLUGIN_ID,
    effect: (ctx) =>
      Effect.gen(function* () {
        yield* ctx.rpc.register(GenerationRpc, {
          text: (input, call) =>
            Effect.gen(function* () {
              const res = yield* ctx.generate
                .text({
                  prompt: input.prompt,
                  model: input.model,
                })
                .pipe(
                  Effect.mapError((err) =>
                    call.error(
                      "kilocode.generation.error",
                      err instanceof Error ? err.message : String(err),
                    ),
                  ),
                )
              return { text: res.text }
            }),
        })
      }).pipe(Effect.orDie),
  })
}
