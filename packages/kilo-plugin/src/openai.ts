import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"

// OpenAI sign-in as on v1: the Codex browser and device-code sign-ins and an API key. v2 adds "Sign in with ChatGPT"
// (ChatGPT token sharing), a third-party sign-in that ChatGPT business workspaces can block with
// `3p_delegated_access_policy_denied`. The Codex sign-ins use the same account and are not affected.
export const KiloOpenAIPlugin = define({
  id: "kilocode.openai",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((editor) => {
      const method = editor.method
        .list("openai")
        .find((item) => item.type === "oauth" && item.id === "chatgpt-token-sharing")
      if (method) editor.method.remove("openai", method)
    })
  }),
})
