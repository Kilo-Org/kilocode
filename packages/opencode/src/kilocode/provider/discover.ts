import { Effect } from "effect"
import type { Auth } from "@/auth"
import type { Config } from "@/config/config"
import type { ModelsDev } from "@/provider/models"
import { providerKey } from "./cloud-auth"

type Entry = NonNullable<Config.Info["provider"]>[string]

/**
 * Adds the model IDs served by `{baseURL}/models` to every config provider that sets
 * `options.discoverModels`. Discovered IDs become plain config model entries, so they are
 * parsed exactly like hand-listed ones and any model listed in config wins over its
 * discovered twin. Untrusted project config cannot turn this on (see KilocodeConfig.undiscover).
 */
export const discover = Effect.fn("KiloProvider.discover")(function* (input: {
  cfg: Config.Info
  catalog: Record<string, ModelsDev.Provider>
  auths: Record<string, Auth.Info>
  envs: Record<string, string | undefined>
  fetch: ModelsDev.Interface["discover"]
}) {
  const disabled = new Set(input.cfg.disabled_providers ?? [])
  const enabled = input.cfg.enabled_providers ? new Set(input.cfg.enabled_providers) : undefined

  const expand = Effect.fnUntraced(function* (id: string, item: Entry) {
    if (item?.options?.discoverModels !== true) return item
    if (disabled.has(id) || (enabled && !enabled.has(id))) return item
    const url = item.options.baseURL ?? item.api ?? input.catalog[id]?.api
    if (!url) return item

    // Resolve the key the way a chat request does: configured apiKey, then a stored API key,
    // then the provider's env var when it names exactly one.
    const auth = input.auths[id]
    const env = item.env ?? input.catalog[id]?.env ?? []
    const name = env.length === 1 ? env.at(0) : undefined
    const key =
      item.options.apiKey ?? (auth ? providerKey(id, auth) : undefined) ?? (name ? input.envs[name] : undefined)
    const raw: unknown = item.options.headers
    const headers =
      typeof raw === "object" && raw !== null
        ? Object.fromEntries(
            Object.entries(raw).filter((pair): pair is [string, string] => typeof pair[1] === "string"),
          )
        : undefined

    const ids = yield* input.fetch({ url, key, headers })
    if (ids.length === 0) return item
    return { ...item, models: { ...Object.fromEntries(ids.map((model) => [model, {}])), ...item.models } }
  })

  // Each fetch is capped at 10 seconds by ModelCache, so a few at a time keeps a cold start bounded.
  return yield* Effect.forEach(
    Object.entries(input.cfg.provider ?? {}),
    ([id, item]) => expand(id, item).pipe(Effect.map((next): [string, Entry] => [id, next])),
    { concurrency: 4 },
  )
})
