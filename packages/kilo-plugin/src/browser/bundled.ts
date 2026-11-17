// The bundled Playwright backend's first tool. The contract's `browser_navigate`, backed by the playwright-core and
// `@playwright/mcp` copies that this build compiles into the binary (see ./playwright). Permissions, the rest of the
// contract and the observation modes are the next unit; this one proves that one contract tool runs in the compiled
// CLI with no Node, no `npx` and no subprocess.
import { define } from "@opencode/plugin/effect/plugin"
import { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import DESCRIPTION from "./browser-navigate.txt"
import { navigate } from "./playwright"

const Parameters = Schema.Struct({
  url: Schema.String.annotate({
    description: "The URL to navigate to",
  }),
})

export const KiloBundledBrowserPlugin = define({
  id: "kilocode.tool-browser-playwright",
  effect: Effect.fn("KiloBundledBrowserTool.Plugin")(function* (ctx) {
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "browser_navigate",
        options: { codemode: false },
        description: DESCRIPTION,
        input: Parameters,
        output: Schema.String,
        execute: (params, _context) =>
          Effect.tryPromise({
            try: () => navigate(params.url),
            catch: (cause) => new Tool.Error({ message: cause instanceof Error ? cause.message : String(cause) }),
          }).pipe(Effect.map((output) => ({ output }))),
      }),
    )
  }),
})
