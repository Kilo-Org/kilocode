import { KiloAgentPlugin } from "./agent"
// kilo_port(gateway:17e39e074eaf) v1 registered the Gateway auth plugin in the upstream plugin list.
import { KiloGatewayPlugin } from "./gateway"
import { OpencodeFreeTier } from "./gateway/opencode"
import { KiloGatewayPolicyPlugin } from "./gateway/policy"
import { GatewayOptions } from "./gateway/options"
import { KiloHandshakePlugin } from "./handshake"
// kilo_port(provider-usage:ce8e021f1ef6) v1 imported the ProviderUsage Location service into location-services.ts.
import { KiloProviderUsagePlugin } from "./provider-usage"
import { KiloOpenAIPlugin } from "./openai"
import { KiloMarketplacePlugin } from "./marketplace"

/**
 * The Kilo plugins on the public plugin API (plugin-first rung 1), in registration order. The Kilo host
 * (`packages/kilo-cli/src/host.ts`) registers each one through `SdkPlugins.register` and provides the
 * global core services that a plugin names in its requirements (the Gateway uses `Bus`, the agents use
 * `Global`). They run after the built-in plugins and before the config plugins.
 *
 * Add a ported Kilo feature here. A Kilo route group is a Kilo RPC: its contract is in
 * `packages/schema/src/kilocode/<feature>.ts`, its plugin registers the handlers with `ctx.rpc.register`, and the
 * server serves it at `POST /api/rpc/<rpc id>/<method>`, as for the Gateway and the handshake.
 */
// kilo_port(server:5e0f8563b425) v1 added the Kilo HttpApi groups to the upstream Api; v2 serves each Kilo group as
// the RPC of a plugin in this list.
export const KiloPlugins = [
  KiloHandshakePlugin,
  // v1 imported the Kilo agent module into agent.ts. kilo_port(agent:2e5632e7bfc6)
  KiloAgentPlugin.Plugin,
  KiloGatewayPlugin,
  // v1 listed the ProviderUsage node in the Location services. kilo_port(provider-usage:b0945f511fb3)
  KiloProviderUsagePlugin,
  KiloOpenAIPlugin,
  KiloMarketplacePlugin,
] as const

/** Kilo plugins that run after the config plugins: the host registers them with phase `post`. */
export const KiloPostPlugins = [
  KiloGatewayPolicyPlugin,
  KiloAgentPlugin.Ceiling,
  GatewayOptions.Plugin,
  OpencodeFreeTier.Plugin,
] as const
