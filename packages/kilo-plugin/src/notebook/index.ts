import type { Context } from "@opencode/plugin/effect/plugin"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { takeBroker, type Endpoint } from "./broker"
import { makeTools } from "./tools"

type Host = Pick<Context, "location" | "permission" | "tool">

/**
 * Register the three notebook tools for one Location. The tools exist only while the extension passes its broker
 * endpoint, so a plain CLI session never sees them.
 */
// kilo_port(notebook:91a426486dc8) v1 registered the notebook service and its routes in the shared server; the
// tools now come from the plugin, and the editor work is served by the extension broker.
export function register(ctx: Host, endpoint: Endpoint | undefined) {
  return Effect.gen(function* () {
    if (!endpoint) return
    const runtime = {
      endpoint,
      directory: ctx.location.directory,
      permission: { assert: ctx.permission.assert },
    }
    const tools = makeTools(runtime)
    yield* ctx.tool.transform((editor) => {
      editor.add(tools.read)
      editor.add(tools.edit)
      editor.add(tools.execute)
    })
  })
}

export const KiloNotebookPlugin = define({
  id: "kilocode.tool-notebook",
  effect: Effect.fn("KiloNotebook.Plugin")(function* (ctx) {
    yield* register(ctx, takeBroker())
  }),
})

