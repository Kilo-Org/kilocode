/**
 * Provider-routing webview messages: upstream endpoint discovery for a model,
 * the project-level config of a session's workspace, and the per-model
 * routing preference written into the global config.
 *
 * Discovery and the project config are resolved in the workspace directory
 * the request names — the one the extension advertised for the session via
 * workspaceDirectoryChanged. An Agent Manager worktree can carry its own
 * project config (a different gateway URL or organization, a project-level
 * pin), so the settings scope must not stand in for it; it is only the
 * fallback for requests without a directory (the Settings editor).
 * Persistence stays global by design; the project scope is only ever edited
 * by hand.
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
  /** The settings scope: the directory for requests that name none. */
  directory: () => string
}

function resolveDirectory(ctx: ModelRoutingContext, requested: unknown): string {
  return typeof requested === "string" && requested !== "" ? requested : ctx.directory()
}

function requestEndpoints(
  ctx: ModelRoutingContext,
  providerID: string,
  modelID: string,
  requestID: number,
  directory: string,
): void {
  const client = ctx.client
  if (!client) {
    ctx.post({ type: "modelEndpointsLoaded", providerID, modelID, requestID, directory, endpoints: [], error: true })
    return
  }
  // Kilo Gateway models may expose gateway-specific endpoints; models configured
  // against OpenRouter directly must only see the public catalog.
  const catalog = providerID === KILO_PROVIDER_ID ? "kilo" : "public"
  void client.kilo.models
    .endpoints({ model: modelID, catalog, directory }, { throwOnError: true })
    .then(({ data }) => {
      ctx.post({ type: "modelEndpointsLoaded", providerID, modelID, requestID, directory, endpoints: [...data] })
    })
    .catch((err: unknown) => {
      console.error("[Kilo New] KiloProvider: Failed to fetch model endpoints:", err)
      ctx.post({ type: "modelEndpointsLoaded", providerID, modelID, requestID, directory, endpoints: [], error: true })
    })
}

/**
 * The project-level config file of a workspace, so the routing chip can lay a
 * project pin over the global selection and flag it.
 */
function requestWorkspaceConfig(ctx: ModelRoutingContext, requestID: number, directory: string): void {
  const client = ctx.client
  if (!client) {
    ctx.post({ type: "workspaceConfigLoaded", requestID, directory, error: true })
    return
  }
  void client.config
    .overlay({ directory, scope: "project" }, { throwOnError: true })
    .then(({ data: overlay }) => {
      const targets = overlay?.targets as { project?: { raw?: Config } } | undefined
      ctx.post({ type: "workspaceConfigLoaded", requestID, directory, projectConfig: targets?.project?.raw })
    })
    .catch((err: unknown) => {
      console.error("[Kilo New] KiloProvider: Failed to fetch workspace config:", err)
      ctx.post({ type: "workspaceConfigLoaded", requestID, directory, error: true })
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
    const input = message as { providerID?: unknown; modelID?: unknown; requestID?: unknown; directory?: unknown }
    if (
      typeof input.providerID === "string" &&
      typeof input.modelID === "string" &&
      typeof input.requestID === "number"
    )
      requestEndpoints(ctx, input.providerID, input.modelID, input.requestID, resolveDirectory(ctx, input.directory))
    return true
  }
  if (message.type === "requestWorkspaceConfig") {
    const input = message as { requestID?: unknown; directory?: unknown }
    if (typeof input.requestID === "number")
      requestWorkspaceConfig(ctx, input.requestID, resolveDirectory(ctx, input.directory))
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
