import { Auth } from "@/auth"
import type { CloudAuth } from "@/kilocode/cloud/auth"
import { Context, Effect, Layer } from "effect"
import { provider as cloud } from "./kilo-cloud"
import { create, type Registry } from "./registry"
import type { Provider } from "./types"

export * from "./types"
export { create as createRegistry, type Registry } from "./registry"
export * as KiloCloud from "./kilo-cloud"

export namespace SessionHost {
  export interface Interface {
    readonly registry: Registry
    /** The authenticated default provider, or `undefined` when none is available. */
    readonly default: Effect.Effect<Provider | undefined>
  }

  export class Service extends Context.Service<Service, Interface>()("@kilocode/SessionHost") {}

  export interface Options {
    readonly env?: CloudAuth.Environment
    readonly fetch?: typeof globalThis.fetch
  }

  export const layer = (options: Options = {}) =>
    Layer.effect(
      Service,
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const registry = create([cloud({ ...options, auth })])
        return { registry, default: registry.default }
      }),
    )
}
