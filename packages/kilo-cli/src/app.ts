import { OPENCODE_CHANNEL, OPENCODE_VERSION } from "@opencode/cli/version"
import { KiloOauthCallbackPage } from "@opencode/core/kilocode/oauth/page"

/**
 * Kilo's app identity: the Kilo name, with the version and channel of this build. A release build defines the
 * version and channel at build time, as for the upstream CLI. A client that starts the host can set its own name
 * with `KILO_CLIENT` (see ./env). The product is what third-party sign-in shows, as on v1: the OpenAI
 * `originator`, the ChatGPT agent name and the OAuth callback page.
 */
export const KiloApp = {
  name: process.env.OPENCODE_CLIENT ?? "kilo2",
  version: OPENCODE_VERSION,
  channel: OPENCODE_CHANNEL,
  // kilo_port(oauth:62e32555f6d9) v1 imported the Kilo callback page into openai.ts; v2 brands the shared page.
  product: { id: "kilo", name: "Kilo", wordmark: KiloOauthCallbackPage.wordmark },
}
