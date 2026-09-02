/**
 * Provider-routing webview messages: upstream endpoint discovery for a model,
 * the effective config of a session's workspace, and the per-model routing
 * preference written into the global config.
 *
 * Discovery and the effective config are resolved in the originating session's
 * directory: an Agent Manager worktree can carry its own project config (a
 * different gateway URL or organization, a project-level pin), so the root
 * workspace's configuration must not stand in for it. Persistence stays global
 * by design; the project scope is only ever edited by hand.
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
  /** Workspace directory of a session; the settings scope without one. */
  directory: (sessionID?: string) => string
}

function requestEndpoints(
  ctx: ModelRoutingContext,
  providerID: string,
  modelID: string,
  requestID: number,
  sessionID: string | undefined,
): void {
  const client = ctx.client
  if (!client) {
    ctx.post({ type: "modelEndpointsLoaded", providerID, modelID, requestID, endpoints: [], error: true })
    return
  }
  const directory = ctx.directory(sessionID)
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
 * The effective config of a session's workspace plus its project-level file,
 * so the routing chip can show what applies to that session and flag a
 * project-level pin that shadows the global selection.
 */
function requestWorkspaceConfig(ctx: ModelRoutingContext, requestID: number, sessionID: string | undefined): void {
  const client = ctx.client
  const directory = ctx.directory(sessionID)
  if (!client) {
    ctx.post({ type: "workspaceConfigLoaded", requestID, directory, config: {}, error: true })
    return
  }
  void Promise.all([
    client.config.get({ directory }, { throwOnError: true }),
    client.config.overlay({ directory, scope: "project" }, { throwOnError: true }),
  ])
    .then(([{ data: config }, { data: overlay }]) => {
      const targets = overlay?.targets as { project?: { raw?: Config } } | undefined
      ctx.post({
        type: "workspaceConfigLoaded",
        requestID,
        directory,
        config,
        projectConfig: targets?.project?.raw,
      })
    })
    .catch((err: unknown) => {
      console.error("[Kilo New] KiloProvider: Failed to fetch workspace config:", err)
      ctx.post({ type: "workspaceConfigLoaded", requestID, directory, config: {}, error: true })
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

/**
 * Handle a provider-routing webview message. Returns true if handled.
 */
export async function routeModelRoutingMessage(message: { type: string }, ctx: ModelRoutingContext): Promise<boolean> {
  if (message.type === "requestModelEndpoints") {
    const input = message as { providerID?: unknown; modelID?: unknown; requestID?: unknown; sessionID?: unknown }
    if (
      typeof input.providerID === "string" &&
      typeof input.modelID === "string" &&
      typeof input.requestID === "number"
    )
      requestEndpoints(ctx, input.providerID, input.modelID, input.requestID, optionalString(input.sessionID))
    return true
  }
  if (message.type === "requestWorkspaceConfig") {
    const input = message as { requestID?: unknown; sessionID?: unknown }
    if (typeof input.requestID === "number")
      requestWorkspaceConfig(ctx, input.requestID, optionalString(input.sessionID))
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
