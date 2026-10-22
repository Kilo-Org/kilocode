import { HEADER_FEATURE } from "../api/constants.js"
import {
  DIRECT_EDIT_ENV,
  extractFencedBody,
  resolveEditTarget,
  type EditTarget,
  type EditUpstreamResponse,
} from "../edit.js"
import { buildMercuryEditPrompt, type MercuryEditContext } from "../edit-prompt.js"
import type { DirectAutocompleteProviderID } from "../autocomplete.js"
import { buildKiloHeaders } from "../headers.js"
import type { AuthStore } from "./handlers.js"

type Auth = Pick<AuthStore, "get">

const EDIT_TIMEOUT_MS = 30_000
const MAX_TOKENS_DEFAULT = 512

async function getProviderKey(Auth: Auth, provider: DirectAutocompleteProviderID): Promise<string | undefined> {
  const auth = await Auth.get(provider)
  if (auth?.type === "api") return auth.key
  return DIRECT_EDIT_ENV[provider].map((key) => process.env[key]).find(Boolean)
}

async function getProxyAuth(Auth: Auth) {
  const auth = await Auth.get("kilo")
  const token = auth?.type === "api" ? auth.key : auth?.type === "oauth" ? auth.access : undefined
  return {
    auth,
    token,
    organizationId: auth?.type === "oauth" ? auth.accountId : undefined,
  }
}

export function createEditHandler(Auth: Auth) {
  return async (c: any) => {
    const { provider, model, maxTokens, ...context } = c.req.valid("json")
    const target = resolveEditTarget(provider, model)

    if (target.provider === "kilo" && !target.url) {
      return c.json({ error: "Next Edit currently requires the Inception provider (mercury-edit-2)." }, 400 as any)
    }

    const proxy = target.provider === "kilo" ? await getProxyAuth(Auth) : undefined
    const token =
      target.provider === "kilo"
        ? proxy?.token
        : await getProviderKey(Auth, target.provider as DirectAutocompleteProviderID)

    if (target.provider === "kilo" && !proxy?.auth) {
      return c.json({ error: "Not authenticated with Kilo Gateway" }, 401 as any)
    }

    if (!token) {
      return c.json({ error: `Missing ${target.provider} provider API key` }, 401 as any)
    }

    // Build the Mercury sentinel prompt here so every client only sends
    // structured editor context.
    const content = buildMercuryEditPrompt(context as MercuryEditContext)
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(EDIT_TIMEOUT_MS)])

    let response: Response
    try {
      response = await fetch(target.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(target.provider === "kilo"
            ? buildKiloHeaders(undefined, { kilocodeOrganizationId: proxy?.organizationId })
            : {}),
          ...(target.provider === "kilo" ? { [HEADER_FEATURE]: "autocomplete" } : {}),
        },
        signal,
        body: JSON.stringify({
          model: target.model,
          max_tokens: maxTokens ?? MAX_TOKENS_DEFAULT,
          // Mercury rejects role:"system" on this endpoint — must be a single
          // user message. See the integration's constants.ts for context.
          messages: [{ role: "user", content }],
        }),
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        return c.json({ error: "Edit request timed out" }, 504 as any)
      }
      if (signal.aborted) return c.json({ error: "Edit request canceled" }, 499 as any)
      throw err
    }

    if (!response.ok) {
      const text = await safeText(response)
      return c.json({ error: `Edit request failed: ${response.status} ${text}` }, response.status as any)
    }

    const json = (await response.json()) as EditUpstreamResponse
    const replyContent = json.choices?.[0]?.message?.content ?? ""
    const body = extractFencedBody(replyContent)
    return c.json({
      content: body,
      usage: json.usage
        ? {
            prompt_tokens: json.usage.prompt_tokens,
            completion_tokens: json.usage.completion_tokens,
          }
        : undefined,
    })
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return "<unreadable>"
  }
}

// Re-export the target type for tests + the opencode handler
export type { EditTarget }
