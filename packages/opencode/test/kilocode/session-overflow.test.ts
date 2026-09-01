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

describe("Kilo post-step compaction safety", () => {
  test("ignores the configured threshold after a provider step", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(149_999) })).toBe(false)
    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(167_999) })).toBe(false)
    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(168_000) })).toBe(true)
  })

  test("uses the usable context limit when the threshold is high", () => {
    const conf = cfg({ threshold_percent: 95 })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(167_999) })).toBe(false)
    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(168_000) })).toBe(true)
  })

  test("uses a model input limit when present", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 400_000, input: 200_000, output: 32_000 })

    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(179_999) })).toBe(false)
    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(180_000) })).toBe(true)
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

  test("uses a lower configured output ceiling for overflow capacity", () => {
    const conf = cfg({ threshold_percent: null })
    const mdl = model({ context: 200_000, output: 100_000 })

    expect(usable({ cfg: conf, model: mdl, outputTokenMax: 8_000 })).toBe(192_000)
    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(180_000), outputTokenMax: 8_000 })).toBe(false)
  })

  test("uses a higher configured output ceiling for overflow capacity", () => {
    const conf = cfg({ threshold_percent: null })
    const mdl = model({ context: 200_000, output: 100_000 })

    expect(usable({ cfg: conf, model: mdl, outputTokenMax: 64_000 })).toBe(136_000)
    expect(isOverflow({ cfg: conf, model: mdl, tokens: tokens(136_000), outputTokenMax: 64_000 })).toBe(true)
  })

  test("uses normalized fields when the provider total disagrees", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(isOverflow({ cfg: conf, model: mdl, tokens: { ...tokens(80_000), total: 250_000 } })).toBe(false)
  })

  test("counts reasoning tokens", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(isOverflow({ cfg: conf, model: mdl, tokens: { ...tokens(167_999), reasoning: 1 } })).toBe(true)
  })

  test("falls back to provider total when normalized usage is unavailable", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(isOverflow({ cfg: conf, model: mdl, tokens: { ...tokens(0), total: 168_000 } })).toBe(true)
  })

  test("uses the output cap as the reserve for single-window gateway models", () => {
    const mdl = model({ context: 262_144, output: 262_144 })

    expect(usable({ cfg: cfg(), model: mdl })).toBe(230_144)
    expect(usable({ cfg: cfg({ reserved: 20_000 }), model: mdl })).toBe(230_144)
  })

  test("keeps usable context for small single-window models with large output limits", () => {
    const mdl = model({ context: 40_000, output: 262_144 })

    expect(usable({ cfg: cfg(), model: mdl })).toBe(8_000)
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

  test("does not reduce output for encoded media payload size", () => {
    const mdl = model({ context: 200_000, output: 32_000 })
    const messages = [
      {
        role: "user",
        content: [{ type: "image", image: `data:image/png;base64,${"x".repeat(600_000)}` }],
      },
    ] satisfies ModelMessage[]
    const usage = KiloSessionOverflow.measure({ messages, tools: {} })

    expect(usage.raw).toBeGreaterThan(usage.normalized)
    expect(KiloLLM.capOutputTokens({ model: mdl, messages, tools: {}, configured: 32_000, usage })).toBe(32_000)
  })

  test.each(["providerMetadata", "providerOptions"] as const)(
    "does not reduce output for encrypted reasoning in %s",
    (field) => {
      const mdl = model({ context: 1_050_000, output: 128_000 })
      const reasoning = {
        type: "reasoning" as const,
        text: "Checked the previous tool results.",
        [field]: {
          openai: {
            itemId: "rs_1",
            reasoningEncryptedContent: "x".repeat(3_200_000),
          },
        },
      }
      const messages = [
        { role: "assistant", content: [reasoning] },
        { role: "user", content: "Continue." },
      ] satisfies ModelMessage[]
      const usage = KiloSessionOverflow.measure({ messages, tools: {} })

      expect(usage.raw).toBeGreaterThan(1_000_000)
      expect(usage.normalized).toBeLessThan(1_000)
      expect(
        KiloLLM.capOutputTokens({
          model: mdl,
          messages,
          tools: {},
          configured: 32_000,
          usage,
          reported: 624_205,
        }),
      ).toBe(32_000)
    },
  )

  test("still counts visible reasoning text", () => {
    const mdl = model({ context: 200_000, output: 32_000 })
    const messages = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "x".repeat(600_000) }],
      },
    ] satisfies ModelMessage[]

    expect(KiloLLM.capOutputTokens({ model: mdl, messages, tools: {}, configured: 32_000 })).toBeLessThan(32_000)
  })

  test("still reduces output for oversized text", () => {
    const mdl = model({ context: 200_000, output: 32_000 })
    const messages = [{ role: "user" as const, content: "x".repeat(600_000) }]

    const cap = KiloLLM.capOutputTokens({ model: mdl, messages, tools: {}, configured: 32_000 })
    expect(cap).toBeGreaterThanOrEqual(1_024)
    expect(cap).toBeLessThan(32_000)
  })

  test("prefers provider-reported context over the client estimate for images", () => {
    // The client cannot price encoded image bytes, but the provider reported a
    // large vision-token cost for the last turn.
    const mdl = model({ context: 300_000, output: 32_000 })
    const messages = [
      {
        role: "user",
        content: [{ type: "image", image: `data:image/png;base64,${"x".repeat(600_000)}` }],
      },
    ] satisfies ModelMessage[]

    // Without reported usage the media-normalized estimate leaves output untouched.
    expect(KiloLLM.capOutputTokens({ model: mdl, messages, tools: {}, configured: 32_000 })).toBe(32_000)

    // With the provider-reported context size, output is capped to fit real usage.
    expect(KiloLLM.capOutputTokens({ model: mdl, messages, tools: {}, configured: 32_000, reported: 280_000 })).toBe(
      17_952,
    )
  })

  test("uses the media-normalized floor when reported usage is smaller", () => {
    const mdl = model({ context: 200_000, output: 32_000 })
    const messages = [{ role: "user" as const, content: "x".repeat(600_000) }]

    const withoutReported = KiloLLM.capOutputTokens({ model: mdl, messages, tools: {}, configured: 32_000 })
    const withStaleReported = KiloLLM.capOutputTokens({
      model: mdl,
      messages,
      tools: {},
      configured: 32_000,
      reported: 1_000,
    })
    expect(withStaleReported).toBe(withoutReported)
    expect(withStaleReported).toBeLessThan(32_000)
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

  test("applies the threshold to the context window, not the model input limit", () => {
    const conf = cfg({ threshold_percent: 75 })
    const mdl = model({ context: 400_000, input: 200_000, output: 32_000 })

    // The 500k-char payload estimates at 162.5k inflated tokens: above 75% of the
    // 200k input limit but below 75% of the 400k context window the UI displays.
    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages: [{ role: "user", content: "x".repeat(500_000) }],
        tools: {},
      }),
    ).toBe(false)

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        tokens: 1_000,
        tail: 100,
        continuation: false,
        reported: 180_000,
      }),
    ).toBe(true)
  })

  test("does not compact when reported usage plus the new message stays below the threshold", () => {
    // GPT-5-style model (272k input of a 400k context), threshold 80%: the
    // whole-payload estimate overshoots past the old input-based limit.
    const conf = cfg({ threshold_percent: 80 })
    const mdl = model({ context: 400_000, input: 272_000, output: 128_000 })

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        tokens: 230_000,
        tail: 2_000,
        continuation: false,
        reported: 160_000,
      }),
    ).toBe(false)
  })

  test("compacts when reported usage reaches the threshold percentage of the context window", () => {
    const conf = cfg({ threshold_percent: 80 })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        tokens: 10_000,
        tail: 0,
        continuation: false,
        reported: 159_999,
      }),
    ).toBe(false)
    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        tokens: 10_000,
        tail: 0,
        continuation: false,
        reported: 160_000,
      }),
    ).toBe(true)
  })

  test("falls back to the full estimate when the provider reports zero usage", () => {
    // A provider that streams successfully but reports no usage yields a reported
    // count of 0; that is not a baseline and must not disable the estimate path.
    const conf = cfg({ threshold_percent: 80 })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        tokens: 170_000,
        tail: 1_000,
        continuation: false,
        reported: 0,
      }),
    ).toBe(true)
  })

  test("keeps conservative accounting for dense multilingual payloads", () => {
    // chars/4 counts 144k tokens for 576k CJK characters, but real tokenizers
    // emit roughly three times that. The safety factor must stay in the trigger.
    const conf = cfg({ threshold_percent: 80 })
    const mdl = model({ context: 200_000, output: 32_000 })

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages: [{ role: "user", content: "字".repeat(576_000) }],
        tools: {},
      }),
    ).toBe(true)
  })

  test("counts system content and tool schemas in the baseline projection", () => {
    // The provider report covers the previous request only; a new system prompt
    // or grown tool schemas must be added on top regardless of the message tail.
    const conf = cfg({ threshold_percent: 80 })
    const mdl = model({ context: 200_000, output: 32_000 })

    // Report of a small prior turn; the new system message alone crosses 160k.
    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        tokens: 100,
        tail: 100,
        overhead: 161_000,
        continuation: false,
        reported: 5_000,
      }),
    ).toBe(true)

    // Without the overhead the same baseline stays below the threshold.
    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        tokens: 100,
        tail: 100,
        continuation: false,
        reported: 5_000,
      }),
    ).toBe(false)
  })

  test("compacts a baseline session whose payload grew outside the message tail", () => {
    // measure() derives the overhead itself: a leading per-message system prompt
    // and a tool schema that alone cross the threshold, on a small reported baseline.
    const conf = cfg({ threshold_percent: 80 })
    const mdl = model({ context: 200_000, output: 32_000 })
    const messages = [
      { role: "system", content: "x".repeat(600_000) },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ] satisfies ModelMessage[]
    const tools = {
      search: {
        description: "search",
        inputSchema: { type: "object", description: "x".repeat(20_000) },
      },
    }

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages,
        tools,
        reported: 5_000,
      }),
    ).toBe(true)

    // The same payload without the system prompt stays below the threshold.
    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages: messages.slice(1),
        tools,
        reported: 5_000,
      }),
    ).toBe(false)
  })

  test("adds newly sent content on top of the provider-reported baseline", () => {
    // Reported usage reflects the previous request only; a large new message must
    // push the projection past the threshold even when opaque reasoning state in
    // the history is invisible to the local estimate.
    const conf = cfg({ threshold_percent: 80 })
    const mdl = model({ context: 1_050_000, output: 128_000 })
    const reasoning = {
      type: "reasoning",
      text: "Checked the previous tool results.",
      providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "x".repeat(3_200_000) } },
    } as const
    const history = [{ role: "assistant", content: [reasoning] }] satisfies ModelMessage[]

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages: [...history, { role: "user", content: "x".repeat(1_000_000) }],
        tools: {},
        reported: 624_205,
      }),
    ).toBe(true)

    // Without the large new message the same baseline stays below the threshold:
    // opaque history must not be re-inflated through the pending-content estimate.
    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages: [...history, { role: "user", content: "Continue." }],
        tools: {},
        reported: 624_205,
      }),
    ).toBe(false)
  })

  test("drops the provider baseline when an unfinished assistant trails the finished one", () => {
    // A cancelled response leaves unfinished content (tool output, partial text)
    // between the report and the tail; the baseline must not anchor on it.
    const finished = { id: "msg-1", tokens: tokens(150_000) }
    const cancelled = { id: "msg-2" }

    expect(KiloSessionOverflow.baseline({ assistant: cancelled, finished })).toBeUndefined()
    expect(KiloSessionOverflow.baseline({ assistant: finished, finished })).toBe(150_000)
    expect(KiloSessionOverflow.baseline({ assistant: finished, finished: undefined })).toBeUndefined()
  })

  test("ignores a report without prompt-side usage as a baseline", () => {
    // A provider returning only completion tokens yields input=0; the report
    // covers no prompt content, so growing prompts would bypass the threshold.
    const outputOnly = { id: "msg-1", tokens: { input: 0, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } }
    expect(KiloSessionOverflow.baseline({ assistant: outputOnly, finished: outputOnly })).toBeUndefined()

    // Cache-read-only input is still prompt coverage (e.g. fully cached prompt).
    const cached = { id: "msg-1", tokens: { input: 0, output: 100, reasoning: 0, cache: { read: 50, write: 0 } } }
    expect(KiloSessionOverflow.baseline({ assistant: cached, finished: cached })).toBe(150)
  })

  test("keeps the summary guard on the reported baseline", () => {
    const summary = { id: "msg-1", summary: true, tokens: tokens(150_000) }

    expect(KiloSessionOverflow.baseline({ assistant: summary, finished: summary })).toBeUndefined()
  })

  test("counts intervening tool output after a cancelled response", () => {
    // The cancelled response never reported usage, so the baseline falls back to
    // the full estimate: reported + tail omits the 300k-char tool result.
    const conf = cfg({ threshold_percent: 80 })
    const mdl = model({ context: 200_000, output: 32_000 })
    const messages = [
      { role: "user", content: "x".repeat(600_000) },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "call-1", toolName: "bash", input: {} }] },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "call-1", toolName: "bash", output: { type: "text", value: "y".repeat(300_000) } }],
      },
      { role: "assistant", content: [{ type: "text", text: "cancelled mid-response" }] },
      { role: "user", content: "Continue." },
    ] satisfies ModelMessage[]

    // 600k chars alone inflate past the 160k threshold; the estimate must decide.
    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        messages,
        tools: {},
      }),
    ).toBe(true)

    // A stale baseline plus the tail-only projection stays below the threshold -
    // the exact omission this guard exists to prevent.
    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        tokens: 10_000,
        tail: 100,
        continuation: false,
        reported: 150_000,
      }),
    ).toBe(false)
  })

  test("triggers at the reserved input ceiling before a high threshold on input-limited models", () => {
    // 80% of the 400k window (320k) exceeds the usable input budget (272k - 20k
    // reserve), so compaction fires at 252k - about 63% of the displayed bar.
    const conf = cfg({ threshold_percent: 80 })
    const mdl = model({ context: 400_000, input: 272_000, output: 128_000 })

    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        tokens: 1_000,
        tail: 0,
        continuation: false,
        reported: 251_999,
      }),
    ).toBe(false)
    expect(
      KiloSessionOverflow.shouldCompact({
        cfg: conf,
        model: mdl,
        usable: usable({ cfg: conf, model: mdl }),
        tokens: 1_000,
        tail: 0,
        continuation: false,
        reported: 252_000,
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
