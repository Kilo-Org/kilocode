import { KiloAgentPlugin } from "./agent"
// kilo_port(gateway:17e39e074eaf) v1 registered the Gateway auth plugin in the upstream plugin list.
import { KiloGatewayPlugin } from "./gateway"

/**
 * The Kilo plugins on the public plugin API (plugin-first rung 1), in registration order. The Kilo host
 * (`packages/kilo-cli/src/host.ts`) registers each one through `SdkPlugins.register` and provides the
 * global core services that a plugin names in its requirements (the Gateway uses `Bus`, the agents use
 * `Global`). They run after the built-in plugins and before the config plugins.
 *
 * Add a ported Kilo feature here. A Kilo RPC keeps its contract in `packages/schema/src/kilocode/<feature>.ts`
 * and registers its handlers with `ctx.rpc.register` in its plugin, as the Gateway does.
 */
export const KiloPlugins = [
  KiloGatewayPlugin,
  // v1 imported the Kilo agent module into agent.ts. kilo_port(agent:2e5632e7bfc6)
  KiloAgentPlugin.Plugin,
] as const

/** Kilo plugins that run after the config plugins: the host registers them with phase `post`. */
export const KiloPostPlugins = [KiloAgentPlugin.Ceiling] as const
