import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "@/provider/transform"

// kilocode_change - new file (#42 / upstream #15215)

describe("ProviderTransform.message - Kilo Gateway reasoning replay", () => {
  const createModel = (overrides: Partial<any> = {}) =>
    ({
      id: "kilo/reflection/beam-free",
      providerID: "kilo",
      api: {
        id: "kilo/reflection/beam-free",
        url: "https://ai-gateway.kilo.ai/api/v1",
        npm: "@kilocode/kilo-gateway",
      },
      name: "Beam 1.0 free",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 200_000, output: 32_000 },
      status: "active",
      options: {},
      headers: {},
      ...overrides,
    }) as any

  const details = (msg: any) => msg?.providerOptions?.openrouter?.reasoning_details

  test("backfills reasoning_details so the gateway keeps assistant reasoning", () => {
    const result = ProviderTransform.message(
      [
        { role: "user", content: "click the dialog" },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "The dialog needs accepting." },
            { type: "text", text: "Accepting now." },
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "kilo-playwright_browser_handle_dialog",
              input: { action: "accept" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "kilo-playwright_browser_handle_dialog",
              output: { type: "text", value: "ok" },
            },
          ],
        },
      ] as any[],
      createModel(),
      {},
    ) as any[]

    expect(details(result[1])).toEqual([
      { type: "reasoning.text", text: "The dialog needs accepting.", format: "unknown" },
    ])
    // The provider SDKs read the reasoning out of `content`; it must survive.
    expect(result[1].content).toEqual([
      { type: "reasoning", text: "The dialog needs accepting." },
      { type: "text", text: "Accepting now." },
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "kilo-playwright_browser_handle_dialog",
        input: { action: "accept" },
      },
    ])
    expect(details(result[0])).toBeUndefined()
    expect(details(result[2])).toBeUndefined()
  })

  test("stays idempotent across retries of the same request", () => {
    const model = createModel()
    const expected = [{ type: "reasoning.text", text: "thinking", format: "unknown" }]
    const first = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "thinking" },
            { type: "text", text: "done" },
          ],
        },
      ] as any[],
      model,
      {},
    ) as any[]

    const second = ProviderTransform.message(first, model, {}) as any[]

    expect(details(first[0])).toEqual(expected)
    expect(details(second[0])).toEqual(expected)
    expect(second[0].content).toEqual([
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "done" },
    ])
  })

  test("merges several reasoning parts into one detail", () => {
    const result = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "first " },
            { type: "text", text: "answer" },
            { type: "reasoning", text: "second" },
          ],
        },
      ] as any[],
      createModel(),
      {},
    ) as any[]

    expect(details(result[0])).toEqual([{ type: "reasoning.text", text: "first second", format: "unknown" }])
  })

  test("keeps provider supplied reasoning_details untouched", () => {
    const result = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [{ type: "reasoning", text: "thinking" }],
          providerOptions: {
            openrouter: {
              reasoning_details: [{ type: "reasoning.encrypted", data: "opaque", format: "google-gemini-v1" }],
            },
          },
        },
      ] as any[],
      createModel(),
      {},
    ) as any[]

    expect(details(result[0])).toEqual([
      { type: "reasoning.encrypted", data: "opaque", format: "google-gemini-v1" },
    ])
  })

  test("does not shadow reasoning_details carried on a tool part", () => {
    const result = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "thinking" },
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "bash",
              input: {},
              providerOptions: {
                openrouter: {
                  reasoning_details: [{ type: "reasoning.text", text: "provider owned", format: "unknown" }],
                },
              },
            },
          ],
        },
      ] as any[],
      createModel(),
      {},
    ) as any[]

    expect(details(result[0])).toBeUndefined()
  })

  test("replays when the provider details would be filtered out for a missing signature", () => {
    // The SDK drops unsigned anthropic/gemini-format reasoning.text, so the wire
    // field would still be missing without a replay.
    const result = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [{ type: "reasoning", text: "thinking" }],
          providerOptions: {
            openrouter: {
              reasoning_details: [{ type: "reasoning.text", text: "thinking", format: "anthropic-claude-v1" }],
            },
          },
        },
      ] as any[],
      createModel(),
      {},
    ) as any[]

    expect(details(result[0])).toEqual([{ type: "reasoning.text", text: "thinking", format: "unknown" }])
  })

  test("replays when a message level empty array shadows usable part details", () => {
    const result = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "thinking" },
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "bash",
              input: {},
              providerOptions: {
                openrouter: {
                  reasoning_details: [{ type: "reasoning.text", text: "provider owned", format: "unknown" }],
                },
              },
            },
          ],
          providerOptions: { openrouter: { reasoning_details: [] } },
        },
      ] as any[],
      createModel(),
      {},
    ) as any[]

    expect(details(result[0])).toEqual([{ type: "reasoning.text", text: "thinking", format: "unknown" }])
  })

  test("survives the providerOptions remap that a kilo keyed message would clobber", () => {
    const result = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "thinking" },
            { type: "text", text: "answer" },
          ],
          providerOptions: { kilo: { cacheControl: { type: "ephemeral" } } },
        },
      ] as any[],
      createModel(),
      {},
    ) as any[]

    expect(result[0].providerOptions.kilo).toBeUndefined()
    expect(result[0].providerOptions.openrouter.cacheControl).toEqual({ type: "ephemeral" })
    expect(details(result[0])).toEqual([{ type: "reasoning.text", text: "thinking", format: "unknown" }])
  })

  test("only touches the messages that need it", () => {
    const result = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [{ type: "reasoning", text: "plain" }],
        },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "already replayed" },
            {
              type: "reasoning",
              text: "second",
              providerOptions: {
                openrouter: { reasoning_details: [{ type: "reasoning.text", text: "real", format: "unknown" }] },
              },
            },
          ],
        },
      ] as any[],
      createModel(),
      {},
    ) as any[]

    expect(details(result[0])).toEqual([{ type: "reasoning.text", text: "plain", format: "unknown" }])
    expect(details(result[1])).toBeUndefined()
  })

  test("preserves sibling providerOptions keys", () => {
    const result = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [{ type: "reasoning", text: "thinking" }],
          providerOptions: {
            openrouter: { annotations: [{ type: "file", file: { hash: "h", name: "n", content: [] } }] },
            other: { keep: true },
          },
        },
      ] as any[],
      createModel(),
      {},
    ) as any[]

    expect(result[0].providerOptions.openrouter.annotations).toEqual([
      { type: "file", file: { hash: "h", name: "n", content: [] } },
    ])
    expect(result[0].providerOptions.other).toEqual({ keep: true })
    expect(details(result[0])).toHaveLength(1)
  })

  test("yields to an explicit interleaved field", () => {
    const result = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "thinking" },
            { type: "text", text: "answer" },
          ],
        },
      ] as any[],
      createModel({
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: { field: "reasoning_content" },
        },
      }),
      {},
    ) as any[]

    expect(details(result[0])).toBeUndefined()
    expect(result[0].providerOptions.openaiCompatible.reasoning_content).toBe("thinking")
  })

  test("leaves non reasoning Kilo Gateway models alone", () => {
    const result = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "thinking" },
            { type: "text", text: "answer" },
          ],
        },
      ] as any[],
      createModel({
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
      }),
      {},
    ) as any[]

    expect(details(result[0])).toBeUndefined()
  })

  test("leaves other npm packages alone", () => {
    for (const npm of [
      "@openrouter/ai-sdk-provider",
      "@ai-sdk/openai",
      "@ai-sdk/anthropic",
      "@ai-sdk/openai-compatible",
      "@ai-sdk/gateway",
    ]) {
      const result = ProviderTransform.message(
        [
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "thinking" },
              { type: "text", text: "answer" },
            ],
          },
        ] as any[],
        createModel({ api: { id: "kilo/reflection/beam-free", url: "https://x/v1", npm } }),
        {},
      ) as any[]

      expect(details(result[0])).toBeUndefined()
    }
  })

  test("leaves models routed to a non-openrouter SDK alone", () => {
    for (const ai_sdk_provider of ["anthropic", "openai", "openai-compatible"] as const) {
      const result = ProviderTransform.message(
        [
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "thinking" },
              { type: "text", text: "answer" },
            ],
          },
        ] as any[],
        createModel({ ai_sdk_provider }),
        {},
      ) as any[]

      expect(details(result[0])).toBeUndefined()
    }
  })

  test("still covers the explicit openrouter route", () => {
    const result = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "thinking" },
            { type: "text", text: "answer" },
          ],
        },
      ] as any[],
      createModel({ ai_sdk_provider: "openrouter" }),
      {},
    ) as any[]

    expect(details(result[0])).toEqual([{ type: "reasoning.text", text: "thinking", format: "unknown" }])
  })

  test("treats a missing reasoning capability as absent", () => {
    const result = ProviderTransform.message(
      [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "thinking" },
            { type: "text", text: "answer" },
          ],
        },
      ] as any[],
      createModel({
        capabilities: {
          temperature: true,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
      }),
      {},
    ) as any[]

    expect(details(result[0])).toBeUndefined()
  })

  test("skips assistant messages without reasoning text", () => {
    const result = ProviderTransform.message(
      [
        { role: "assistant", content: [{ type: "reasoning", text: "" }, { type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "text", text: "no reasoning here" }] },
        { role: "assistant", content: "string content" },
      ] as any[],
      createModel(),
      {},
    ) as any[]

    expect(details(result[0])).toBeUndefined()
    expect(details(result[1])).toBeUndefined()
    expect(details(result[2])).toBeUndefined()
  })

  test("adds no reasoning_details when nothing applies", () => {
    const result = ProviderTransform.message(
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ] as any[],
      createModel(),
      {},
    ) as any[]

    expect(result).toHaveLength(2)
    expect(result.every((msg) => details(msg) === undefined)).toBe(true)
  })

  test("does not mutate the messages it was given", () => {
    const input = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "answer" },
        ],
      },
    ] as any[]

    ProviderTransform.message(input, createModel(), {})

    expect(input[0].providerOptions).toBeUndefined()
  })
})
