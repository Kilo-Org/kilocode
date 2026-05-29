import { KILO_API_BASE } from "./api/constants.js"
import { getAutocompleteModel, type DirectAutocompleteProviderID } from "./autocomplete.js"

/**
 * Env var(s) consulted as a fallback for BYOK keys when the provider hasn't
 * been authenticated via the gateway's Auth store. Mirrors `DIRECT_FIM_ENV`.
 */
export const DIRECT_EDIT_ENV: Record<DirectAutocompleteProviderID, string[]> = {
  mistral: ["MISTRAL_API_KEY"],
  inception: ["INCEPTION_API_KEY"],
}

export type EditTarget =
  | { provider: "inception"; model: string; url: string }
  | { provider: "kilo"; model: string; url: string }

/** Shape of the upstream (Mercury) chat/edit completion response we read from. */
export interface EditUpstreamResponse {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

const INCEPTION_EDIT_URL = "https://api.inceptionlabs.ai/v1/edit/completions"
const KILO_NEXTEDIT_URL = KILO_API_BASE + "/api/edit/completions"

/**
 * Pick the upstream edit endpoint for a (provider, model) pair. Today this is
 * either Inception's `/v1/edit/completions` (direct BYOK) or the Kilo Gateway's
 * `/api/edit/completions` proxy, which forwards to Inception server-side.
 * Mistral does not expose a comparable surface.
 */
export function resolveEditTarget(provider?: string, model?: string): EditTarget {
  const info = getAutocompleteModel(provider, model)
  if (info.kind === "edit") {
    if (info.providerID === "kilo") {
      // The gateway expects the upstream model id with the `inception/` prefix
      // (it strips it before forwarding to Inception). The kilo entry's
      // `requestModel` already carries the prefix.
      const m = info.requestModel.includes("/") ? info.requestModel : `inception/${info.requestModel}`
      return { provider: "kilo", model: m, url: KILO_NEXTEDIT_URL }
    }
    if (info.directProvider === "inception") {
      return { provider: "inception", model: info.requestModel, url: INCEPTION_EDIT_URL }
    }
  }
  // Non-edit models fall through to a kilo placeholder with no URL so the
  // handler can surface a 400 rather than silently routing somewhere unexpected.
  return { provider: "kilo", model: info.requestModel, url: "" }
}

/**
 * Mercury wraps the rewritten editable region in a triple-backtick fence,
 * sometimes with a language tag and sometimes with `<|code_to_edit|>` sentinels
 * inside. Strip all of that down to the bare code. Shared by both the hono and
 * the Effect HttpApi edit handlers so the parsing can't drift between them.
 */
export function extractFencedBody(message: string): string {
  if (!message) return ""
  const fenceOpen = message.indexOf("```")
  if (fenceOpen === -1) return message
  const afterFenceOpen = message.indexOf("\n", fenceOpen + 3)
  if (afterFenceOpen === -1) return ""
  // A missing closing fence means the replacement was truncated. Applying a
  // partial editable region can delete valid trailing code, so suppress it.
  const fenceClose = message.indexOf("```", afterFenceOpen + 1)
  if (fenceClose === -1) return ""
  let body = message.slice(afterFenceOpen + 1, fenceClose)
  if (body.endsWith("\n")) body = body.slice(0, -1)
  body = body.replace(/^<\|code_to_edit\|>\n?/, "")
  body = body.replace(/\n?<\|\/code_to_edit\|>$/, "")
  return body
}
