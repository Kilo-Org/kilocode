/**
 * Provider-routing webview messages: upstream endpoint discovery for a model
 * and the per-model routing preference written into the global config.
 *
 * Kept out of the KiloProvider message switch so the routing write path stays
 * independently testable — the config shapes themselves live in
 * ../shared/provider-routing, shared with the webview Settings path.
 */

import { routingUnsetPaths, routingValue } from "../shared/provider-routing"
import { KILO_PROVIDER_ID } from "../shared/provider-model"
import type { Config, KiloClient } from "@kilocode/sdk/v2/client"

export type ModelRoutingContext = {
  client: KiloClient | null
  post: (message: unknown) => void
  /** Global-config write path; `unset` clears exactly the listed paths. */
  updateConfig: (partial: Partial<Config>, unset?: string[][]) => Promise<void>
}

function requestEndpoints(ctx: ModelRoutingContext, providerID: string, modelID: string, requestID: number): void {
  const client = ctx.client
  if (!client) {
    ctx.post({ type: "modelEndpointsLoaded", providerID, modelID, requestID, endpoints: [], error: true })
    return
  }
  // Kilo Gateway models may expose gateway-specific endpoints; models configured
  // against OpenRouter directly must only see the public catalog.
  const catalog = providerID === KILO_PROVIDER_ID ? "kilo" : "public"
  void client.kilo.models
    .endpoints({ model: modelID, catalog }, { throwOnError: true })
    .then(({ data }) => {
      ctx.post({ type: "modelEndpointsLoaded", providerID, modelID, requestID, endpoints: [...data] })
    })
    .catch((err: unknown) => {
      console.error("[Kilo New] KiloProvider: Failed to fetch model endpoints:", err)
      ctx.post({ type: "modelEndpointsLoaded", providerID, modelID, requestID, endpoints: [], error: true })
    })
}

async function persistRouting(
  ctx: ModelRoutingContext,
  providerID: string,
  modelID: string,
  provider: string | null,
): Promise<void> {
  if (provider === null) {
    // Unset only the fields this UI owns — sibling routing preferences the
    // user configured by hand (e.g. data_collection, sort) stay untouched.
    await ctx.updateConfig({}, routingUnsetPaths(providerID, modelID))
    return
  }
  await ctx.updateConfig({
    provider: {
      [providerID]: {
        models: {
          [modelID]: {
            options: { provider: routingValue(provider) },
          },
        },
      },
    },
  })
}

/**
 * Handle a provider-routing webview message. Returns true if handled.
 */
export async function routeModelRoutingMessage(message: { type: string }, ctx: ModelRoutingContext): Promise<boolean> {
  if (message.type === "requestModelEndpoints") {
    const input = message as { providerID?: unknown; modelID?: unknown; requestID?: unknown }
    if (
      typeof input.providerID === "string" &&
      typeof input.modelID === "string" &&
      typeof input.requestID === "number"
    )
      requestEndpoints(ctx, input.providerID, input.modelID, input.requestID)
    return true
  }
  if (message.type === "persistModelRouting") {
    const input = message as { providerID?: unknown; modelID?: unknown; provider?: unknown }
    if (typeof input.providerID === "string" && typeof input.modelID === "string")
      await persistRouting(
        ctx,
        input.providerID,
        input.modelID,
        typeof input.provider === "string" ? input.provider : null,
      )
    return true
  }
  return false
}
