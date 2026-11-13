import { SubagentTool } from "@opencode/core/tool/plugin/subagent"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"

// The shared tool waits for the child unless the call asks for the background. Kilo wants the opposite: a call that
// omits `background` runs in the background, because the field defaults to true while the input is decoded, before
// the tracker or the tool see it.
const Background = Schema.Boolean.annotate({
  description:
    "Defaults to true: runs in the background and returns immediately; you are notified when it finishes. Set false only when you need the answer before you can continue.",
}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(true)))

// Upstream's description still presents the background as the special case that only suits independent work, which
// pushes the model to pass `background: false` for anything it needs a result from. Kilo states its own default in
// those sentences; the rest of the upstream description is untouched.
const descriptionRewrites = [
  [
    "Foreground (default) runs the subagent to completion and returns its final response.",
    "Runs in the background by default: the call returns immediately with the child session ID and you are notified when the subagent finishes.",
  ],
  [
    "Background mode (background=true) launches it asynchronously and returns immediately; you are notified when it finishes.",
    "Several background subagents started in one message run in parallel, so you do not wait for one before starting the next.",
  ],
  [
    "Use background only for independent work that can run while you continue elsewhere.",
    "Keep working on non-overlapping tasks, or briefly tell the user what you launched and end your response. Pass background: false only when you need the subagent's answer before you can continue.",
  ],
] as const

// Composed once: a State replay re-runs the transform, and rebuilding the struct would re-derive its JSON schema
// for every replay.
const Input = Schema.Struct({ ...SubagentTool.Input.fields, background: Background })

export const KiloSubagentBackgroundPlugin = define({
  id: "kilocode.subagent-background",
  effect: Effect.fn("KiloSubagentBackground.Plugin")(function* (ctx) {
    yield* ctx.tool
      .transform((editor) =>
        editor.update(SubagentTool.name, (tool) => {
          tool.description = descriptionRewrites.reduce(
            (description, [from, to]) => description.replace(from, to),
            tool.description,
          )
          tool.input = Input
        }),
      )
      .pipe(Effect.orDie)
  }),
})
