import { SubagentTool } from "@opencode/core/tool/plugin/subagent"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"

// The shared tool waits for the child unless the call asks for the background. Kilo wants the opposite: a call that
// omits `background` runs in the background, because the field defaults to true while the input is decoded, before
// the tracker or the tool see it.
const Background = Schema.Boolean.annotate({
  description:
    "Defaults to true: runs in the background and returns immediately. Set false to wait for the final response.",
}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(true)))

// Composed once: a State replay re-runs the transform, and rebuilding the struct would re-derive its JSON schema
// for every replay.
const Input = Schema.Struct({ ...SubagentTool.Input.fields, background: Background })

export const KiloSubagentBackgroundPlugin = define({
  id: "kilocode.subagent-background",
  effect: Effect.fn("KiloSubagentBackground.Plugin")(function* (ctx) {
    yield* ctx.tool
      .transform((editor) =>
        editor.update(SubagentTool.name, (tool) => {
          tool.description = tool.description.replace(
            "Foreground (default) runs the subagent to completion and returns its final response.",
            "Runs in the background by default.",
          )
          tool.input = Input
        }),
      )
      .pipe(Effect.orDie)
  }),
})
