/**
 * Provider action handlers extracted from KiloProvider to stay under max-lines.
 * These are pure async functions that operate on the SDK client — no vscode dependency.
 */
import type { KiloClient } from "@kilocode/sdk/v2"
import { validateProviderID as validateProviderIDShared } from "./shared/custom-provider"
import { sanitizeCustomProviderConfig } from "./shared/custom-provider"

type PostMessage = (message: unknown) => void
type GetErrorMessage = (error: unknown) => string

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

export async function connectProvider(ctx: ActionContext, requestId: string, providerID: string, apiKey: string) {
  const id = validateID(ctx, requestId, providerID, "connect")
  if (!id) return
  try {
    await ctx.client.auth.set({ providerID: id, auth: { type: "api", key: apiKey } }, { throwOnError: true })
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

async function isConfigCustom(client: KiloClient, providerID: string): Promise<boolean> {
  try {
    const globalConfig = (await client.global.config.get({ throwOnError: true })).data ?? {}
    const entry = globalConfig.provider?.[providerID]
    if (!entry) return false
    if (entry.npm !== "@ai-sdk/openai-compatible") return false
    if (!entry.models || Object.keys(entry.models).length === 0) return false
    return true
  } catch {
    return false
  }
}

export async function disconnectProvider(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  cachedConfigMessage: unknown,
  setCachedConfig: (msg: unknown) => void,
) {
  const id = validateID(ctx, requestId, providerID, "disconnect")
  if (!id) return
  try {
    const custom = await isConfigCustom(ctx.client, id)

    if (custom) {
      await ctx.client.auth.remove({ providerID: id }, { throwOnError: true }).catch(() => undefined)
    } else {
      await ctx.client.auth.remove({ providerID: id }, { throwOnError: true })
    }

    if (id === "kilo") {
      ctx.postMessage({ type: "profileData", data: null })
    }

    if (custom) {
      const globalConfig = (await ctx.client.global.config.get({ throwOnError: true })).data ?? {}
      const disabled = globalConfig.disabled_providers ?? []
      if (!disabled.includes(id)) {
        const merged = (
          await ctx.client.global.config.update(
            { config: { disabled_providers: [...disabled, id] } },
            { throwOnError: true },
          )
        ).data
        if (merged) {
          const msg = { type: "configLoaded", config: merged }
          setCachedConfig(msg)
          ctx.postMessage({ type: "configUpdated", config: merged })
        }
      }
    }

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
    const { data: updated } = await ctx.client.global.config.update(
      {
        config: {
          provider: { [id]: sanitized.value },
          disabled_providers: nextDisabled,
        },
      },
      { throwOnError: true },
    )

    const msg = { type: "configLoaded", config: updated }
    setCachedConfig(msg)
    ctx.postMessage({ type: "configUpdated", config: updated })

    try {
      if (apiKey) {
        await ctx.client.auth.set({ providerID: id, auth: { type: "api", key: apiKey } }, { throwOnError: true })
      } else {
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
