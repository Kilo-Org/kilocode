import { Effect } from "effect"
import { HostedFailure, type Provider, type ProviderID } from "./types"

export interface Registry {
  readonly providers: readonly Provider[]
  readonly register: (provider: Provider) => void
  readonly get: (id: ProviderID) => Provider | undefined
  readonly require: (id: ProviderID) => Effect.Effect<Provider, HostedFailure>
  /**
   * The provider explicitly marked as default, and only while it reports
   * itself available. There is no fallback provider and no local fallback, so
   * a signed-out provider yields `undefined` rather than a silent alternative.
   */
  readonly default: Effect.Effect<Provider | undefined>
}

export function create(initial: readonly Provider[] = []): Registry {
  const providers: Provider[] = []
  const byID = new Map<ProviderID, Provider>()

  const register = (provider: Provider) => {
    if (byID.has(provider.id)) throw new Error(`Duplicate session host provider: ${provider.id}`)
    providers.push(provider)
    byID.set(provider.id, provider)
  }

  const get = (id: ProviderID) => byID.get(id)

  const require = (id: ProviderID) => {
    const provider = byID.get(id)
    if (provider) return Effect.succeed(provider)
    return Effect.fail(
      new HostedFailure({
        code: "unknown_provider",
        message: `Session host provider is not registered: ${id}`,
        retryable: false,
      }),
    )
  }

  const pick = Effect.gen(function* () {
    for (const provider of providers) {
      if (provider.default !== true) continue
      const availability = yield* provider.availability
      if (availability.state === "available") return provider
    }
    return undefined
  })

  for (const provider of initial) register(provider)

  return { providers, register, get, require, default: pick }
}
