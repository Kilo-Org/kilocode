import { HEADER_FEATURE } from "../api/constants.js"
import type { DirectAutocompleteProviderID } from "../autocomplete.js"
import { DIRECT_FIM_ENV, requestMistralFim, resolveFimTarget, type FimTarget } from "../fim.js"
import { buildKiloHeaders } from "../headers.js"
import type { AuthStore } from "./handlers.js"

type Auth = Pick<AuthStore, "get">

const FIM_TIMEOUT_MS = 30_000

async function getProxyAuth(Auth: Auth) {
  const auth = await Auth.get("kilo")
  const token = auth?.type === "api" ? auth.key : auth?.type === "oauth" ? auth.access : undefined
  return {
    auth,
    token,
    organizationId: auth?.type === "oauth" ? auth.accountId : undefined,
  }
}

async function getProviderKey(Auth: Auth, provider: DirectAutocompleteProviderID) {
  const auth = await Auth.get(provider)
  if (auth?.type === "api") return auth.key
  return DIRECT_FIM_ENV[provider].map((key) => process.env[key]).find(Boolean)
}

async function fetchFim(
  target: FimTarget,
  key: string,
  input: {
    prefix: string
    suffix: string
    maxTokens: number
    temperature: number
    signal: AbortSignal
    organizationId?: string
  },
): Promise<Response> {
  const run = async (url: string) => {
    console.info(`[FIM] request provider=${target.provider} model=${target.model} url=${url}`)
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        ...(target.provider === "kilo"
          ? buildKiloHeaders(undefined, { kilocodeOrganizationId: input.organizationId })
          : {}),
        ...(target.provider === "kilo" ? { [HEADER_FEATURE]: "autocomplete" } : {}),
      },
      signal: input.signal,
      body: JSON.stringify({
        model: target.model,
        prompt: input.prefix,
        suffix: input.suffix,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
        stream: true,
      }),
    })
  }

  if (target.provider === "mistral") return requestMistralFim(run)
  return run(target.url)
}

export function createFimHandler(Auth: Auth) {
  return async (c: any) => {
    const { prefix, suffix, provider, model, maxTokens, temperature } = c.req.valid("json")
    const target = resolveFimTarget(provider, model)
    const fimMaxTokens = maxTokens ?? 256
    const fimTemperature = temperature ?? 0.2
    const proxy = target.provider === "kilo" ? await getProxyAuth(Auth) : undefined
    const token = target.provider === "kilo" ? proxy?.token : await getProviderKey(Auth, target.provider)

    if (target.provider === "kilo" && !proxy?.auth) {
      return c.json({ error: "Not authenticated with Kilo Gateway" }, 401)
    }

    if (target.provider === "kilo" && !token) {
      return c.json({ error: "No valid token found" }, 401)
    }

    if (!token) {
      return c.json({ error: `Missing ${target.provider} provider API key` }, 401)
    }

    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(FIM_TIMEOUT_MS)])

    try {
      const response = await fetchFim(target, token, {
        prefix,
        suffix,
        maxTokens: fimMaxTokens,
        temperature: fimTemperature,
        signal,
        organizationId: proxy?.organizationId,
      })

      if (!response.ok) {
        const text = await response.text()
        return c.json({ error: `FIM request failed: ${response.status} ${text}` }, response.status as any)
      }

      return new Response(response.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        return c.json({ error: "FIM request timed out" }, 504 as any)
      }
      if (signal.aborted) return c.json({ error: "FIM request canceled" }, 499 as any)
      throw err
    }
  }
}
