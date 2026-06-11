// kilocode_change - new file
import type { Plugin } from "@kilocode/plugin"
import { authenticateWithLlmapiDeviceAuth } from "./llmapi-device-auth"

/**
 * LLMAPI Authentication Plugin
 *
 * Declares the auth methods for the built-in `llmapi` provider: pasting an API
 * key, and "Sign in with LLMAPI" (an RFC 8628 device-authorization flow that
 * mints a project API key). Both methods end with an API key stored as
 * `{ type: "api", key }`, which the loader feeds to the openai-compatible SDK.
 */
export const LLMAPIAuthPlugin: Plugin = async () => {
  return {
    auth: {
      provider: "llmapi",
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth?.type === "api") {
          return { apiKey: auth.key }
        }
        return {}
      },
      methods: [
        {
          type: "api",
          label: "API Key",
          prompts: [{ type: "text", key: "apiKey", message: "LLMAPI API Key" }],
          async authorize(inputs) {
            const key = inputs?.apiKey?.trim()
            if (!key) return { type: "failed" }
            return { type: "success", key }
          },
        },
        {
          type: "oauth",
          label: "Sign in with LLMAPI",
          async authorize() {
            return await authenticateWithLlmapiDeviceAuth()
          },
        },
      ],
    },
  }
}

export default LLMAPIAuthPlugin
