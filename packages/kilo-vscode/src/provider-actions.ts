/**
 * Provider action handlers extracted from KiloProvider to stay under max-lines.
 * These are pure async functions that operate on the SDK client — no vscode dependency.
 */
import type { Config, KiloClient } from "@kilocode/sdk/v2"
import { validateProviderID as validateProviderIDShared } from "./shared/custom-provider"
import {
  resolveCustomProviderAuth,
  sanitizeCustomProviderConfig,
  withCustomProviderDeletions,
} from "./shared/custom-provider"
import { CUSTOM_PROVIDER_PACKAGE, KILO_AUTO, parseModelString } from "./shared/provider-model"
import { configFeatures } from "./features"

/**
 * Compute the default model selection from CLI config, VS Code settings, or hardcoded fallback.
 * Pure function — takes cachedConfig and vscode settings as parameters.
 */
type AuthState = "api" | "oauth" | "wellknown"

function disabledWithout(list: string[] | undefined, id: string) {
  return (list ?? []).filter((item) => item !== id)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function customProvider(config: unknown) {
  return record(config) && config.npm === CUSTOM_PROVIDER_PACKAGE
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    return a.every((value, index) => same(value, b[index]))
  }
  if (!record(a) || !record(b)) return false
  const akeys = Object.keys(a).sort()
  const bkeys = Object.keys(b).sort()
  if (akeys.length !== bkeys.length) return false
  return akeys.every((key, index) => key === bkeys[index] && same(a[key], b[key]))
}

/** Fetch auth methods alongside the provider list. Auth states default to empty (endpoint not yet available). */
export async function fetchProviderData(client: KiloClient, dir: string) {
  const authRequest =
    typeof client.provider.auth === "function"
      ? client.provider
          .auth({ directory: dir }, { throwOnError: true })
          .then((r) => r.data ?? {})
          .catch(() => ({}))
      : Promise.resolve({})

  const [{ data: response }, authMethods] = await Promise.all([
    client.provider.list({ directory: dir }, { throwOnError: true }),
    authRequest,
  ])
  const authStates: Record<string, AuthState> = {}
  const all = response.all.map((item) => {
    const raw = item as Record<string, unknown>
    if (typeof raw.id === "string" && typeof raw.key === "string" && raw.key) {
      authStates[raw.id] = "api"
    }
    if (!("key" in raw)) return item
    const next = { ...raw }
    delete next.key
    return next as (typeof response.all)[number]
  })
  return { response: { ...response, all }, authMethods, authStates }
}

export function buildActionContext(
  client: KiloClient,
  post: (msg: unknown) => void,
  errFn: (err: unknown) => string,
  dir: string,
  refresh: () => Promise<void>,
): ActionContext {
  return {
    client,
    postMessage: post,
    getErrorMessage: errFn,
    workspaceDir: dir,
    disposeGlobal: async (reason: string) => {
      // Wait for the server to finish disposing before refreshing providers.
      // Shared State.dispose() now has a hard per-disposer timeout, so this
      // wait is bounded without needing a client-side timeout here.
      await client.global.dispose().catch((error: unknown) => {
        console.warn(`[Kilo New] KiloProvider: global.dispose() after ${reason} failed:`, error)
      })
    },
    fetchAndSendProviders: refresh,
  }
}

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

type PostMessage = (message: unknown) => void
type GetErrorMessage = (error: unknown) => string
type SetCachedConfig = (msg: unknown) => void
type AuthMetadata = Record<string, string>

interface ActionContext {
  client: KiloClient
  postMessage: PostMessage
  getErrorMessage: GetErrorMessage
  workspaceDir: string
  disposeGlobal: (reason: string) => Promise<void>
  fetchAndSendProviders: () => Promise<void>
}

function postError(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  action: "connect" | "disconnect" | "authorize",
  message: string,
) {
  ctx.postMessage({ type: "providerActionError", requestId, providerID, action, message })
}

function validateID(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  action: "connect" | "disconnect" | "authorize",
): string | null {
  const result = validateProviderIDShared(providerID)
  if ("value" in result) return result.value
  postError(ctx, requestId, providerID, action, result.error)
  return null
}

function cleanMetadata(input?: Record<string, unknown>): AuthMetadata | undefined {
  const entries = Object.entries(input ?? {})
    .map(([key, value]) => [key, typeof value === "string" ? value.trim() : ""] as const)
    .filter(([key, value]) => key !== "" && value !== "")
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

async function configs(ctx: ActionContext) {
  const [{ data: global }, { data: merged }] = await Promise.all([
    ctx.client.global.config.get({ throwOnError: true }),
    ctx.client.config.get({ directory: ctx.workspaceDir }, { throwOnError: true }),
  ])
  return { global: global ?? {}, merged: merged ?? {} }
}

async function refreshConfig(ctx: ActionContext, setCachedConfig: SetCachedConfig) {
  const [{ data: config }, { data: global }] = await Promise.all([
    ctx.client.config.get({ directory: ctx.workspaceDir }, { throwOnError: true }),
    ctx.client.global.config.get({ throwOnError: true }),
  ])
  if (!config) return
  const features = configFeatures(config)
  setCachedConfig({ type: "configLoaded", config, globalConfig: global, features })
  ctx.postMessage({ type: "configUpdated", config, globalConfig: global, features })
}

async function saveGlobal(ctx: ActionContext, config: Config) {
  await ctx.client.global.config.update({ config }, { throwOnError: true })
}

async function saveProject(ctx: ActionContext, config: Config) {
  await ctx.client.config.update({ config, directory: ctx.workspaceDir }, { throwOnError: true })
}

async function removeAuth(ctx: ActionContext, id: string, configured: boolean) {
  try {
    await ctx.client.auth.remove({ providerID: id }, { throwOnError: true })
  } catch (err) {
    if (!configured) throw err
    console.warn(`[Kilo New] auth.remove failed for configured provider ${id} (non-fatal):`, err)
  }
}

async function removeCustom(ctx: ActionContext, id: string, global: Config, merged: Config) {
  const cfg = global.provider?.[id]
  const effective = merged.provider?.[id]
  const tasks = []
  if (customProvider(cfg)) {
    tasks.push(
      saveGlobal(ctx, {
        provider: { [id]: null },
        disabled_providers: disabledWithout(global.disabled_providers, id),
      }),
    )
  }
  if (customProvider(effective)) {
    tasks.push(saveProject(ctx, { provider: { [id]: null } }))
  }
  await Promise.all(tasks)
}

async function disableConfigured(ctx: ActionContext, id: string, config: Config) {
  const disabled = config.disabled_providers ?? []
  if (disabled.includes(id)) return
  await saveGlobal(ctx, { disabled_providers: [...disabled, id] })
}

async function enableConfigured(ctx: ActionContext, id: string, config: Config) {
  const disabled = disabledWithout(config.disabled_providers, id)
  if (disabled.length === (config.disabled_providers ?? []).length) return
  await saveGlobal(ctx, { disabled_providers: disabled })
}

export async function connectProvider(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  apiKey: string,
  metadata?: Record<string, unknown>,
) {
  const id = validateID(ctx, requestId, providerID, "connect")
  if (!id) return
  try {
    const meta = cleanMetadata(metadata)
    const auth = meta ? { type: "api" as const, key: apiKey, metadata: meta } : { type: "api" as const, key: apiKey }
    await ctx.client.auth.set({ providerID: id, auth }, { throwOnError: true })
    await ctx.disposeGlobal(`provider connect (${id})`)
    await ctx.fetchAndSendProviders()
    ctx.postMessage({ type: "providerConnected", requestId, providerID: id })
  } catch (error) {
    postError(ctx, requestId, providerID, "connect", ctx.getErrorMessage(error) || "Failed to connect provider")
  }
}

export async function authorizeProviderOAuth(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  method: number,
) {
  const id = validateID(ctx, requestId, providerID, "authorize")
  if (!id) return
  try {
    const { data: authorization } = await ctx.client.provider.oauth.authorize(
      { providerID: id, method, directory: ctx.workspaceDir },
      { throwOnError: true },
    )
    if (!authorization) {
      postError(ctx, requestId, providerID, "authorize", "Failed to start provider authorization")
      return
    }
    ctx.postMessage({ type: "providerOAuthReady", requestId, providerID: id, authorization })
  } catch (error) {
    postError(
      ctx,
      requestId,
      providerID,
      "authorize",
      ctx.getErrorMessage(error) || "Failed to start provider authorization",
    )
  }
}

export async function completeProviderOAuth(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  method: number,
  code?: string,
) {
  const id = validateID(ctx, requestId, providerID, "connect")
  if (!id) return
  try {
    await ctx.client.provider.oauth.callback(
      { providerID: id, method, code, directory: ctx.workspaceDir },
      { throwOnError: true },
    )
    await ctx.disposeGlobal(`provider oauth (${id})`)
    await ctx.fetchAndSendProviders()
    ctx.postMessage({ type: "providerConnected", requestId, providerID: id })
  } catch (error) {
    postError(
      ctx,
      requestId,
      providerID,
      "connect",
      ctx.getErrorMessage(error) || "Failed to complete provider authorization",
    )
  }
}

export async function disconnectProvider(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  cachedConfigMessage: unknown,
  setCachedConfig: SetCachedConfig,
) {
  const id = validateID(ctx, requestId, providerID, "disconnect")
  if (!id) return
  try {
    const config = await configs(ctx)
    const cfg = config.global.provider?.[id]
    const effective = config.merged.provider?.[id]
    const configured = !!cfg || !!effective
    const custom = customProvider(cfg) || customProvider(effective)
    const { response } = await fetchProviderData(ctx.client, ctx.workspaceDir)
    const active = response.all.find((item) => item.id === id)
    const oauth = active?.source === "custom" && configured && !custom

    // Config-sourced providers may not have auth store entries because
    // credentials can come from config or env, so auth removal is non-fatal.
    await removeAuth(ctx, id, configured)

    if (id === "kilo") {
      ctx.postMessage({ type: "profileData", data: null })
    }

    if (custom) {
      await removeCustom(ctx, id, config.global, config.merged)
    }

    // Config-sourced built-in providers stay "connected" after auth.remove
    // because the server rebuilds state from config. Add to disabled_providers
    // so the server excludes them while preserving config for re-enable.
    if (configured && !oauth && !custom) {
      await disableConfigured(ctx, id, config.global)
    }

    if (oauth) {
      await enableConfigured(ctx, id, config.global)
    }

    if (configured) await refreshConfig(ctx, setCachedConfig)

    await ctx.disposeGlobal(`provider disconnect (${id})`)
    await ctx.fetchAndSendProviders()
    ctx.postMessage({ type: "providerDisconnected", requestId, providerID: id })
  } catch (error) {
    postError(ctx, requestId, providerID, "disconnect", ctx.getErrorMessage(error) || "Failed to disconnect provider")
  }
}

export async function saveCustomProvider(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  provider: Record<string, unknown>,
  apiKey: string | undefined,
  apiKeyChanged: boolean,
  cachedConfigMessage: unknown,
  setCachedConfig: (msg: unknown) => void,
) {
  const id = validateID(ctx, requestId, providerID, "connect")
  if (!id) return

  const sanitized = sanitizeCustomProviderConfig(provider)
  if ("error" in sanitized) {
    postError(ctx, requestId, providerID, "connect", sanitized.error)
    return
  }

  const refresh = async () => {
    await ctx.disposeGlobal(`custom provider save (${id})`)
    await ctx.fetchAndSendProviders()
  }

  try {
    const globalConfig = (await ctx.client.global.config.get({ throwOnError: true })).data ?? {}
    const disabled = globalConfig.disabled_providers ?? []
    const nextDisabled = disabled.filter((item: string) => item !== id)
    const existing = (globalConfig.provider as Record<string, unknown> | undefined)?.[id]
    const patch = withCustomProviderDeletions(existing, sanitized.value)
    const { data: updated } = await ctx.client.global.config.update(
      {
        config: {
          provider: { [id]: patch },
          disabled_providers: nextDisabled,
        },
      },
      { throwOnError: true },
    )

    const merged = await ctx.client.config.get({ directory: ctx.workspaceDir }, { throwOnError: true })
    const config = merged.data ?? updated
    const msg = { type: "configLoaded", config, globalConfig: updated, features: configFeatures(config) }
    setCachedConfig(msg)
    ctx.postMessage({ type: "configUpdated", config, globalConfig: updated, features: configFeatures(config) })

    const auth = resolveCustomProviderAuth(apiKey, apiKeyChanged)

    try {
      if (auth.mode === "set") {
        await ctx.client.auth.set({ providerID: id, auth: { type: "api", key: auth.key } }, { throwOnError: true })
      }
      if (auth.mode === "clear") {
        await ctx.client.auth.remove({ providerID: id }, { throwOnError: true })
      }
    } catch (error) {
      await refresh()
      postError(ctx, requestId, providerID, "connect", ctx.getErrorMessage(error) || "Failed to save custom provider")
      return
    }

    await refresh()
    ctx.postMessage({ type: "providerConnected", requestId, providerID: id })
  } catch (error) {
    postError(ctx, requestId, providerID, "connect", ctx.getErrorMessage(error) || "Failed to save custom provider")
  }
}
