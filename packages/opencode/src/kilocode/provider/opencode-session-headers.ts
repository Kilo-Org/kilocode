import { USER_AGENT } from "@/installation"

/**
 * The OpenCode Go managed-inference API requires a stable `x-opencode-session` header on
 * every request routed through an `opencode*` provider (anaconda/kilocode#13723). The main
 * chat path gets this from `LLMRequestPrep.prepare` (session/llm/request.ts); any other
 * caller that resolves a language model and invokes the `ai` SDK directly must attach it here.
 */
export function opencodeSessionHeaders(input: { providerID: string; sessionID: string }): Record<string, string> {
  return input.providerID.startsWith("opencode")
    ? {
        "x-opencode-session": input.sessionID,
        "User-Agent": USER_AGENT,
      }
    : {}
}
