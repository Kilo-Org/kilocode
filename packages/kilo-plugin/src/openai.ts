import { browser, headless } from "@opencode/core/plugin/provider/openai"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"

// OpenAI sign-in as on v1: "ChatGPT Pro/Plus (browser)", "ChatGPT Pro/Plus (headless)" and "Manually enter API Key".
// These are the upstream Codex sign-ins with the v1 labels. v2 also adds "Sign in with ChatGPT" (ChatGPT token
// sharing), a third-party sign-in that ChatGPT business workspaces can block with `3p_delegated_access_policy_denied`;
// the Codex sign-ins use the same account and are not affected, so Kilo does not offer it.
export const KiloOpenAIPlugin = define({
  id: "kilocode.openai",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((editor) => {
      // Copy the list: removing a method changes the editor's array.
      const methods = [...editor.method.list("openai")]
      const oauth = (id: string) => methods.find((item) => item.type === "oauth" && item.id === id)
      const sharing = oauth("chatgpt-token-sharing")
      if (sharing) editor.method.remove("openai", sharing)
      if (oauth("chatgpt-browser")) editor.method.update(label(browser(ctx.app), "ChatGPT Pro/Plus (browser)"))
      if (oauth("chatgpt-headless")) editor.method.update(label(headless(ctx.app), "ChatGPT Pro/Plus (headless)"))
      if (methods.some((item) => item.type === "key"))
        editor.method.update({ integrationID: "openai", method: { type: "key", label: "Manually enter API Key" } })
    })
  }),
})

function label(registration: IntegrationOAuthMethodRegistration, text: string) {
  return { ...registration, method: { ...registration.method, label: text } }
}
