// Plugin used by the issue #8656 regression tests.
//
// It attaches the simulated socket from stall-transport.ts to the `mock`
// provider through the plugin `config` hook. This is the supported injection
// point: src/provider/provider.ts loads plugins before reading `cfg.provider`
// exactly so hooks can add options such as `fetch`. Injecting here keeps the
// simulation scoped to the test's own instance instead of replacing
// `globalThis.fetch` for the whole test process.

import { createStallTransport } from "./stall-transport"

type Options = { state?: unknown; answer?: unknown; provider?: unknown }

type Draft = {
  provider?: Record<string, { options?: Record<string, unknown> } | undefined>
}

export default async (_input: unknown, options?: Options) => ({
  config: async (cfg: Draft) => {
    const id = typeof options?.provider === "string" ? options.provider : "mock"
    const provider = cfg.provider?.[id]
    const state = typeof options?.state === "string" ? options.state : undefined
    if (!provider || !state) return
    provider.options ??= {}
    provider.options["fetch"] = createStallTransport({
      state,
      answer: typeof options?.answer === "string" ? options.answer : undefined,
    })
  },
})
