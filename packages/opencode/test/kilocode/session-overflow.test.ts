import { describe, expect, test } from "bun:test"
import { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "@/session/message-v2"
import { isOverflow } from "@/session/overflow"

function cfg(compaction?: Config.Info["compaction"]) {
  return Config.Info.zod.parse({ compaction })
}

function model(opts: { context: number; output: number; input?: number }): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

function tokens(count: number): MessageV2.Assistant["tokens"] {
  return { input: count, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
}

describe("Kilo auto-compaction threshold", () => {
  test("triggers at the configured context percentage", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(149_999) })).toBe(false)
    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(150_000) })).toBe(true)
  })

  test("keeps the reserved safety trigger when it is lower", () => {
    const conf = cfg({ threshold_percent: 95 })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(167_999) })).toBe(false)
    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(168_000) })).toBe(true)
  })

  test("uses a model input limit when present", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 400_000, input: 200_000, output: 32_000 })

    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(149_999) })).toBe(false)
    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(150_000) })).toBe(true)
  })

  test("ignores a cleared threshold", () => {
    const conf = cfg({ threshold_percent: null })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(150_000) })).toBe(false)
    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(168_000) })).toBe(true)
  })

  test("still respects disabled auto-compaction", () => {
    const conf = cfg({ auto: false, threshold_percent: 75 })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(150_000) })).toBe(false)
  })
})
