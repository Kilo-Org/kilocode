// Host side of Fetch models in the custom provider dialog. It picks the key (typed, an `{env:NAME}` variable of the
// server environment, or the stored credential of an existing provider), applies the custom headers and lists the
// models. A stored key is read from the server credential API here and never posted to the webview.
import { OpenCode, type CredentialEntry } from "@opencode/client"
import { local } from "./local"
import type { FetchCustomProviderModels, ToWebview } from "./protocol"
import { environment, type Manager } from "./server"
import { fetchOpenAIModels, FetchModelsError, sameBaseURL } from "./shared/fetch-models"

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/

export async function fetchCustomProviderModels(input: {
  server: Manager
  directory: string
  request: FetchCustomProviderModels
  /** The extension host environment; the server starts with the same variables. */
  env?: NodeJS.ProcessEnv
}): Promise<Extract<ToWebview, { type: "customProviderModelsFetched" }>> {
  const request = input.request
  const env = environment(input.env ?? process.env, {})
  try {
    const apiKey = await resolveKey(request, env, (providerID) =>
      storedKey(input.server, input.directory, providerID, request.baseURL),
    )
    const models = await fetchOpenAIModels({
      baseURL: request.baseURL,
      apiKey,
      headers: resolveHeaders(request.headers, env),
    })
    return { type: "customProviderModelsFetched", requestId: request.requestId, models }
  } catch (error) {
    return {
      type: "customProviderModelsFetched",
      requestId: request.requestId,
      error: error instanceof Error ? error.message : "Failed to fetch models",
      auth: error instanceof FetchModelsError && error.auth,
    }
  }
}

/** A typed key first, then an `{env:NAME}` variable, then the stored credential of the existing provider. */
export async function resolveKey(
  request: Pick<FetchCustomProviderModels, "apiKey" | "env" | "providerID">,
  env: NodeJS.ProcessEnv,
  stored: (providerID: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  const typed = request.apiKey?.trim()
  if (typed) return typed
  if (request.env) return ENV_NAME.test(request.env) ? env[request.env]?.trim() || undefined : undefined
  if (request.providerID) return stored(request.providerID)
  return undefined
}

/** Header values may use `{env:NAME}`; the server substitutes them the same way, and an unset name is empty. */
export function resolveHeaders(headers: Record<string, string> | undefined, env: NodeJS.ProcessEnv) {
  if (!headers) return undefined
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      value.replace(/\{env:([^}]+)\}/g, (_, name: string) => env[name] || ""),
    ]),
  )
}

/**
 * The stored key of an existing provider: its active key credential, else its newest one. It applies only while the
 * requested URL is the provider's saved base URL, so an edited URL field can never send the stored secret to another
 * host.
 */
export function storedKeyFor(
  provider: { id: string; integrationID?: string; settings?: Record<string, unknown> },
  credentials: readonly CredentialEntry[],
  baseURL: string,
): string | undefined {
  const saved = provider.settings?.baseURL
  if (typeof saved !== "string" || !sameBaseURL(saved, baseURL)) return undefined
  const integrationID = provider.integrationID ?? provider.id
  const keys = credentials.flatMap((entry) =>
    entry.integrationID === integrationID && entry.value.type === "key"
      ? [{ active: entry.active, key: entry.value.key }]
      : [],
  )
  return (keys.find((entry) => entry.active) ?? keys.at(-1))?.key
}

async function storedKey(server: Manager, directory: string, providerID: string, baseURL: string) {
  const current = await server.get()
  const api = OpenCode.make({ baseUrl: current.url, headers: { authorization: current.authorization }, fetch: local })
  // An unknown provider (for example one not saved yet) has no stored key.
  const provider = await api.provider.get({ providerID, location: { directory } }).catch(() => undefined)
  if (!provider) return undefined
  return storedKeyFor(provider.data, await api.credential.list(), baseURL)
}
