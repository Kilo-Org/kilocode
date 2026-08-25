// Plugin used by the issue #6905 reproduction tests.
//
// Attaches the simulated socket from bad-toolcall-transport.ts to the `mock`
// provider through the plugin `config` hook, same injection point as
// stall-plugin.ts.

import { createBadToolCallTransport } from "./bad-toolcall-transport"

type Options = { state?: unknown }

type Draft = {
  provider?: Record<string, { options?: Record<string, unknown> } | undefined>
}

export default async (_input: unknown, options?: Options) => ({
  config: async (cfg: Draft) => {
    const provider = cfg.provider?.["mock"]
    const state = typeof options?.state === "string" ? options.state : undefined
    if (!provider || !state) return
    provider.options ??= {}
    provider.options["fetch"] = createBadToolCallTransport({ state })
  },
})
