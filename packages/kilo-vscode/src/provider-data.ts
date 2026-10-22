/**
 * Provider data for the model picker, from v1 `provider-actions.ts`. Provider connect, OAuth, disconnect and custom
 * providers are not available with the Kilo v2 server yet, so only the read path is here. No vscode dependency.
 */
import type { KiloClient } from "@kilocode/sdk-v1/v2"
import { KILO_AUTO, KILO_PROVIDER_ID, parseModelString } from "./shared/provider-model"

/**
 * Compute the default model selection from CLI config, VS Code settings, or hardcoded fallback.
 * Pure function, takes cachedConfig and vscode settings as parameters.
 */
type AuthState = "api" | "oauth" | "wellknown"

/** Fetch provider availability and authentication state without exposing stored credentials. */
export async function fetchProviderData(client: KiloClient, dir: string) {
  const kiloRequest = client.kilo
    .authStatus({ directory: dir }, { throwOnError: true })
    .then((r) => r.data)
    .catch(() => undefined)

  const [{ data: response }, kiloAuth] = await Promise.all([
    client.provider.list({ directory: dir }, { throwOnError: true }),
    kiloRequest,
  ])
  // Provider auth methods belong to provider connect, which is not available with the Kilo v2 server yet.
  const authMethods = {}
  const authStates: Record<string, AuthState> = {}
  const all = response.all.map((item) => {
    const raw = item as Record<string, unknown>
    if (typeof raw.id === "string" && typeof raw.key === "string" && raw.key) authStates[raw.id] = "api"
    if (!("key" in raw)) return item
    const next = { ...raw }
    delete next.key
    return next as (typeof response.all)[number]
  })
  delete authStates[KILO_PROVIDER_ID]
  if (kiloAuth?.authenticated && kiloAuth.type) authStates[KILO_PROVIDER_ID] = kiloAuth.type
  const organizationId = kiloAuth ? (kiloAuth.organizationId ?? null) : undefined
  const defaults = { ...response.default }
  if (organizationId) {
    const models = all.find((item) => item.id === KILO_PROVIDER_ID)?.models ?? {}
    const recommended = response.default[KILO_PROVIDER_ID]
    const model = recommended && Object.hasOwn(models, recommended) ? recommended : Object.keys(models).at(0)
    if (model) defaults[KILO_PROVIDER_ID] = model
    if (!model) delete defaults[KILO_PROVIDER_ID]
  }
  if (!kiloAuth) delete defaults[KILO_PROVIDER_ID]
  return {
    response: {
      ...response,
      all: kiloAuth ? all : all.filter((item) => item.id !== KILO_PROVIDER_ID),
      connected: kiloAuth ? response.connected : response.connected.filter((id) => id !== KILO_PROVIDER_ID),
      default: defaults,
    },
    authMethods,
    authStates,
    organizationId,
    ready: !!kiloAuth,
    unavailable: catalogUnavailable(response.failed, all, organizationId),
  }
}

/** An organization's Kilo catalog failed to load, so Kilo has no models to pick. */
function catalogUnavailable(
  failed: string[] | undefined,
  all: ReadonlyArray<{ id: string; models: Record<string, unknown> }>,
  organizationId: string | null | undefined,
) {
  if (!organizationId || !failed?.includes(KILO_PROVIDER_ID)) return false
  return Object.keys(all.find((item) => item.id === KILO_PROVIDER_ID)?.models ?? {}).length === 0
}

/**
 * Resolve the stored API key for a model fetch on an existing provider.
 * The key is only applied when the requested URL matches the provider's
 * configured baseURL, so a stored secret can never be redirected to a
 * different host (e.g. after the user edits the URL field).
 */
function isModelSelection(r: unknown): r is { providerID: string; modelID: string } {
  return (
    !!r &&
    typeof r === "object" &&
    typeof (r as Record<string, unknown>).providerID === "string" &&
    typeof (r as Record<string, unknown>).modelID === "string"
  )
}

/** Validate and sanitize recent model selections from untrusted sources. */
export function validateRecents(raw: unknown): Array<{ providerID: string; modelID: string }> {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isModelSelection)
    .slice(0, 5)
    .map((r) => ({ providerID: r.providerID, modelID: r.modelID }))
}

/** Validate and sanitize favorite model selections from untrusted sources. */
export function validateFavorites(raw: unknown): Array<{ providerID: string; modelID: string }> {
  if (!Array.isArray(raw)) return []
  return raw.filter(isModelSelection).map((r) => ({ providerID: r.providerID, modelID: r.modelID }))
}

/** Validate and sanitize per-mode model selections from untrusted sources. */
export function validateModelSelections(raw: unknown): Record<string, { providerID: string; modelID: string }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const result: Record<string, { providerID: string; modelID: string }> = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (isModelSelection(val)) {
      result[key] = { providerID: val.providerID, modelID: val.modelID }
    }
  }
  return result
}

export function computeDefaultSelection(
  cachedConfig: { config?: { model?: string } } | null,
  vscodePID: string,
  vscodeMID: string,
): { providerID: string; modelID: string } {
  const configured = parseModelString(cachedConfig?.config?.model)
  if (configured) return configured
  if (vscodePID && vscodeMID) return { providerID: vscodePID, modelID: vscodeMID }
  return { ...KILO_AUTO }
}
