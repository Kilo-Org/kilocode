export * as KiloRequestIdentity from "./request-identity"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"

/**
 * How Kilo names itself on a model request to a provider that is not the Kilo Gateway. The server builds every
 * model request with the same `User-Agent` and no referer; this replaces them per provider:
 *
 * - `opencode*` providers and `anthropic`: `kilo/<channel>/<version>/<client>`, and nothing else.
 * - every other provider: `Kilo-Code/<version>` with the Kilo `HTTP-Referer` and `X-Title`.
 * - providers in `untouched`: nothing, the request keeps what the server and the provider's own plugin built.
 *
 * The values are request headers, so they take precedence over a `User-Agent`, `HTTP-Referer` or `X-Title` from the
 * provider catalog or from `provider.<id>.options.headers` in config.
 */
const REFERER = "https://kilocode.ai"
const TITLE = "Kilo Code"

/**
 * Providers whose request identity is not Kilo's to set:
 *
 * - `kilo`: the Gateway plugin writes its own attribution headers.
 * - `openai` and GitHub Copilot: their plugins own the request identity of the ChatGPT and Copilot backends
 *   (originator, session and interaction headers), and those requests keep the user agent the server built.
 * - `snowflake-cortex`: its plugin sets the user agent on the outgoing request, after this hook.
 * - `claude-agent`: served in process by the Claude Agent SDK, which names itself.
 *
 * Provider IDs are compared as values and never used as keys, because a user picks the ID of a custom provider.
 */
function untouched(providerID: string) {
  return (
    providerID === "kilo" ||
    providerID === "openai" ||
    providerID.includes("github-copilot") ||
    providerID === "snowflake-cortex" ||
    providerID === "claude-agent"
  )
}

// One path segment of a user agent. The client name comes from the environment of whoever starts the server.
function segment(value: string | undefined) {
  return value?.replace(/[^\w.+-]/g, "") || "unknown"
}

/** The identity headers of a model request to `providerID`, or undefined when the request is left as built. */
export function headers(
  providerID: string,
  app: { readonly name?: string; readonly version?: string; readonly channel?: string },
): Record<string, string> | undefined {
  if (untouched(providerID)) return undefined
  if (providerID.startsWith("opencode") || providerID === "anthropic")
    return { "User-Agent": `kilo/${segment(app.channel)}/${segment(app.version)}/${segment(app.name)}` }
  return { "HTTP-Referer": REFERER, "X-Title": TITLE, "User-Agent": `Kilo-Code/${segment(app.version)}` }
}

/**
 * Writes `identity` into the headers of a request. Header names are case-insensitive on the wire, so a name that is
 * already present in another case is replaced instead of sent twice.
 */
export function apply(target: Record<string, string>, identity: Readonly<Record<string, string>>) {
  const names = new Set(Object.keys(identity).map((name) => name.toLowerCase()))
  Object.keys(target)
    .filter((name) => names.has(name.toLowerCase()))
    .forEach((name) => delete target[name])
  Object.assign(target, identity)
}

export const Plugin = define({
  id: "kilocode.request-identity",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.session.hook("model.request", (event) =>
      Effect.sync(() => {
        const identity = headers(event.model.providerID, ctx.app)
        if (identity) apply(event.headers, identity)
      }),
    )
  }),
})
