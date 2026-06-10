import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import type { ModelMessage } from "ai"
import { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { KiloLLM } from "@/kilocode/session/llm"
import { KiloSessionOverflow } from "@/kilocode/session/overflow"
import type { MessageV2 } from "@/session/message-v2"
import { isOverflow, usable } from "@/session/overflow"

function cfg(compaction?: Config.Info["compaction"]): Config.Info {
  const config = Schema.decodeUnknownSync(Config.Info)({ compaction })
  return {
    ...config,
    skills: config.skills && {
      paths: config.skills.paths && [...config.skills.paths],
      urls: config.skills.urls && [...config.skills.urls],
    },
  }
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

  test("uses normalized fields when the provider total disagrees", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(isOverflow({ cfg: conf, model: mdl, tokens: { ...tokens(80_000), total: 250_000 } })).toBe(false)
  })

  test("counts reasoning tokens", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(isOverflow({ cfg: conf, model: mdl, tokens: { ...tokens(149_999), reasoning: 1 } })).toBe(true)
  })

  test("falls back to provider total when normalized usage is unavailable", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(isOverflow({ cfg: conf, model: mdl, tokens: { ...tokens(0), total: 150_000 } })).toBe(true)
  })
})

describe("Kilo request estimation", () => {
  test("skips output estimation when no output cap can use it", () => {
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(KiloLLM.needsEstimate({ model: mdl, configured: undefined })).toBe(false)
    expect(KiloLLM.needsEstimate({ model: mdl, configured: 0 })).toBe(false)
    expect(KiloLLM.needsEstimate({ model: model({ context: 0, output: 32_000 }), configured: 32_000 })).toBe(false)
    expect(KiloLLM.needsEstimate({ model: mdl, configured: 32_000 })).toBe(true)
  })
})

describe("Kilo preflight compaction", () => {
  test("triggers from estimated outgoing context without provider usage", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 200_000, output: 32_000 })
    const messages = [{ role: "user" as const, content: "x".repeat(600_000) }]

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages,
        tools: {},
      }),
    ).toBe(true)
  })

  test("includes tool schemas in the outgoing estimate", () => {
    const conf = cfg({ threshold_percent: 50 })
    const mdl = model({ context: 10_000, output: 1_000 })

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages: [{ role: "user", content: "hello" }],
        tools: {
          search: {
            description: "search",
            inputSchema: { type: "object", description: "x".repeat(20_000) },
          },
        },
      }),
    ).toBe(true)
  })

  test("uses the model input limit for the preflight percentage", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 400_000, input: 200_000, output: 32_000 })

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages: [{ role: "user", content: "x".repeat(500_000) }],
        tools: {},
      }),
    ).toBe(true)
  })

  test("does not preflight compact a current turn after tool execution", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 200_000, output: 32_000 })
    const messages = [
      { role: "user", content: "x".repeat(600_000) },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call-1", toolName: "bash", input: { cmd: "pwd" } }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "text", value: "done" },
          },
        ],
      },
    ] satisfies ModelMessage[]

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages,
        tools: {},
      }),
    ).toBe(false)
  })

  test("does not preflight compact without an explicit percentage", () => {
    const conf = cfg({})
    const mdl = model({ context: 200_000, output: 32_000 })
    const messages = [{ role: "user" as const, content: "x".repeat(600_000) }]

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages,
        tools: {},
      }),
    ).toBe(false)
  })

  test("does not preflight compact when automatic compaction is disabled", () => {
    const conf = cfg({ auto: false, threshold_percent: 75 })
    const mdl = model({ context: 200_000, output: 32_000 })
    const messages = [{ role: "user" as const, content: "x".repeat(600_000) }]

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages,
        tools: {},
      }),
    ).toBe(false)
  })

  test("does not treat encoded media size as context tokens", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 200_000, output: 32_000 })
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "describe this image" },
          { type: "file", mediaType: "image/png", data: "x".repeat(600_000) },
        ],
      },
    ] satisfies ModelMessage[]

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages,
        tools: {},
      }),
    ).toBe(false)
  })

  test("normalizes provider image payloads in the estimate", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "image", image: `data:image/png;base64,${"x".repeat(600_000)}` }],
      },
    ] satisfies ModelMessage[]

    const usage = KiloSessionOverflow.measure({ messages, tools: {} })
    expect(usage.normalized).toBeLessThan(100)
    expect(usage.raw).toBeGreaterThan(100_000)
  })

  test("accounts for binary provider image payloads in the raw estimate", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "image", image: new Uint8Array(600_000) }],
      },
    ] satisfies ModelMessage[]

    const usage = KiloSessionOverflow.measure({ messages, tools: {} })
    expect(usage.normalized).toBeLessThan(100)
    expect(usage.raw).toBeGreaterThan(100_000)
  })

  test("still compacts oversized text when the request includes media", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 200_000, output: 32_000 })
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "x".repeat(600_000) },
          { type: "file", mediaType: "image/png", data: "image" },
        ],
      },
    ] satisfies ModelMessage[]

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages,
        tools: {},
      }),
    ).toBe(true)
  })
})
