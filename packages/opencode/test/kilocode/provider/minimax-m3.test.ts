import { describe, expect, test } from "bun:test"
import { mergeDeep } from "remeda"
import { kiloProviderOptions } from "@/kilocode/provider-options"
import { ProviderTransform } from "@/provider/transform"

const model = {
  id: "kilo/minimax/minimax-m3",
  providerID: "kilo",
  api: {
    id: "minimax/minimax-m3",
    url: "https://api.kilo.ai/api/openrouter",
    npm: "@kilocode/kilo-gateway",
  },
  capabilities: { reasoning: true },
  limit: { output: 64_000 },
} as any

describe("Kilo Gateway MiniMax M3 thinking", () => {
  test("defaults to adaptive thinking", () => {
    const options = ProviderTransform.options({ model, sessionID: "test-session" })

    expect(options.reasoning).toEqual({ enabled: true })
    expect(kiloProviderOptions(options).anthropic.thinking).toEqual({ type: "adaptive" })
  })

  test("allows the none variant to disable thinking", () => {
    const base = ProviderTransform.options({ model, sessionID: "test-session" })
    const options = mergeDeep(base, { reasoning: { enabled: false, effort: "none" } })

    expect(kiloProviderOptions(options).anthropic.thinking).toEqual({ type: "disabled" })
  })
})
