import { Effect, Schema } from "effect"
import type { Config } from "@/config/config"

export const fields = {
  includeIgnored: Schema.optional(Schema.Boolean).annotate({
    description:
      "Also search paths excluded by ignore files such as .gitignore, and hidden directories (default false). Requires the user to enable the experimental.glob_search_ignored setting; otherwise the call fails.",
  }),
}

/** Resolve ripgrep options for `includeIgnored`, failing unless the user opted in through config. */
export const options = (config: Config.Interface, input: { readonly includeIgnored?: boolean }) =>
  Effect.gen(function* () {
    if (input.includeIgnored !== true) return {}
    const cfg = yield* config.get()
    if (cfg.experimental?.glob_search_ignored !== true)
      return yield* Effect.fail(
        new Error(
          "includeIgnored requires the experimental.glob_search_ignored setting, which is disabled. Retry without includeIgnored, or ask the user to enable the setting.",
        ),
      )
    return { noIgnore: true, hidden: true }
  })
