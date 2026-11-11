export * as KiloRequestIdentity from "./request-identity"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"

// How Kilo names itself on a model request to a provider that is not the Kilo Gateway, in two parts:
//
// - The user agent. The server builds every model request with its own; `Plugin` replaces it on the request:
//   `kilo/<channel>/<version>/<client>` for the `opencode*` providers and `anthropic`, `Kilo-Code/<version>` for
//   the other providers.
// - The referer and title, for those other providers only. `Referer` sets them on the provider as a default,
//   where the upstream plugins set theirs, so a header that config sets on the provider or on a model still wins.
//
// Providers in `untouched` get neither.

/** The Kilo default of a provider header, and the upstream default it takes the place of. */
const DEFAULTS = [
  { name: "HTTP-Referer", value: "https://kilocode.ai", upstream: "https://opencode.ai/" },
  { name: "X-Title", value: "Kilo Code", upstream: "opencode" },
]

/**
 * Providers whose request identity is not Kilo's to set:
 *
 * - `kilo`: the Gateway plugin writes its own attribution headers.
 * - `openai` and `github-copilot`: their plugins own the request identity of the ChatGPT and Copilot backends
 *   (originator, session and interaction headers), and those requests keep the user agent the server built.
 * - `xai`: its sign-in names the client itself, and the model requests stay consistent with it.
 * - `snowflake-cortex`: its plugin sets the user agent on the outgoing request, after this hook.
 * - `claude-agent`: served in process by the Claude Agent SDK, which names itself.
 *
 * Provider IDs are compared as values and never used as keys, because a user picks the ID of a custom provider.
 */
function untouched(providerID: string) {
  return (
    providerID === "kilo" ||
    providerID === "openai" ||
    providerID === "github-copilot" ||
    providerID === "xai" ||
    providerID === "snowflake-cortex" ||
    providerID === "claude-agent"
  )
}

// The providers that get the client user agent, and no referer or title.
function client(providerID: string) {
  return providerID.startsWith("opencode") || providerID === "anthropic"
}

// One path segment of a user agent. The client name comes from the environment of whoever starts the server.
function segment(value: string | undefined) {
  return value?.replace(/[^\w.+-]/g, "") || "unknown"
}

/** The user agent of a model request to `providerID`, or undefined when the request keeps the one it has. */
export function userAgent(
  providerID: string,
  app: { readonly name?: string; readonly version?: string; readonly channel?: string },
) {
  if (untouched(providerID)) return undefined
  if (client(providerID)) return `kilo/${segment(app.channel)}/${segment(app.version)}/${segment(app.name)}`
  return `Kilo-Code/${segment(app.version)}`
}

/**
 * The headers of provider `providerID` with the Kilo referer and title, or undefined when they stay as they are.
 * A default is written only where the provider has no such header, in any case, or has the upstream default: any
 * other value was configured for this provider and is kept.
 */
export function referer(providerID: string, headers: Readonly<Record<string, string>> = {}) {
  if (untouched(providerID) || client(providerID)) return undefined
  const entries = Object.entries(headers)
  const pending = DEFAULTS.filter((item) =>
    entries
      .filter(([name]) => name.toLowerCase() === item.name.toLowerCase())
      .every(([, value]) => value === item.upstream),
  )
  if (pending.length === 0) return undefined
  const names = new Set(pending.map((item) => item.name.toLowerCase()))
  return Object.fromEntries([
    ...entries.filter(([name]) => !names.has(name.toLowerCase())),
    ...pending.map((item) => [item.name, item.value]),
  ])
}

/**
 * Sets the user agent of each model request. It registers before the config plugins, so a `model.request` hook of
 * a user plugin can still replace it. Header names are case-insensitive on the wire, so a user agent that is
 * already present in another case is replaced instead of sent twice.
 */
export const Plugin = define({
  id: "kilocode.request-identity",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.session.hook("model.request", (event) =>
      Effect.sync(() => {
        const value = userAgent(event.model.providerID, ctx.app)
        if (value === undefined) return
        Object.keys(event.headers)
          .filter((name) => name.toLowerCase() === "user-agent")
          .forEach((name) => delete event.headers[name])
        event.headers["User-Agent"] = value
      }),
    )
  }),
})

/**
 * Sets the default referer and title of each provider. It runs after the config plugins (phase `post`), so the
 * providers that config defines exist and the headers that config sets are already on them.
 */
export const Referer = define({
  id: "kilocode.request-identity.referer",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((providers) => {
      providers.list().forEach((item) => {
        const headers = referer(item.provider.id, item.provider.headers)
        if (headers)
          providers.update(item.provider.id, (provider) => {
            provider.headers = headers
          })
      })
    })
  }),
})
