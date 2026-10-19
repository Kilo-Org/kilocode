// kilo_port(gateway:17e39e074eaf) v1 registered the Gateway auth plugin in the upstream plugin list.
import { KiloGatewayPlugin } from "@opencode/core/kilocode/gateway"

/**
 * The Kilo plugins on the public plugin API (plugin-first rung 1), in registration order. The Kilo host
 * (`packages/kilo-cli/src/host.ts`) registers each one through `SdkPlugins.register` and provides the
 * global core services that a plugin names in its requirements (the Gateway uses `Bus`).
 *
 * Add a ported Kilo feature here. The Gateway adapter still lives in `@opencode/core/kilocode` until it
 * moves into this package with its RPC (U-E0-02, #15173).
 */
export const KiloPlugins = [KiloGatewayPlugin] as const
