import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Effect, Layer } from "effect"
import path from "path"
import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { LLMAISDK } from "@/session/llm/ai-sdk"
import { KiloGeneratedFile } from "@/kilocode/session/generated-file"
import { Image } from "@/image/image"
import { LLM } from "../../../src/session/llm"
import { MessageV2 } from "../../../src/session/message-v2"
import { SessionProcessor } from "../../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../../src/session/schema"
import { SessionStatus } from "../../../src/session/status"
import { SessionSummary } from "../../../src/session/summary"
import { provideTmpdirServer } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"
import { raw, TestLLMServer } from "../../lib/llm-server"

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

describe("KiloGeneratedFile.from", () => {
  test("wraps inline base64 images in a data URL", () => {
    expect(KiloGeneratedFile.from({ mediaType: "image/png", base64: PNG })).toEqual({
      mime: "image/png",
      url: `data:image/png;base64,${PNG}`,
    })
  })

  test("keeps hosted image URLs as-is", () => {
    expect(KiloGeneratedFile.from({ mediaType: "image/jpeg", base64: "https://cdn.example.com/a.jpg" })).toEqual({
      mime: "image/jpeg",
      url: "https://cdn.example.com/a.jpg",
    })
  })

  test("ignores non-image and empty files", () => {
    expect(KiloGeneratedFile.from({ mediaType: "audio/wav", base64: "AAAA" })).toBeUndefined()
    expect(KiloGeneratedFile.from({ mediaType: "image/png", base64: "" })).toBeUndefined()
  })
})

const part = (mime: string, url: string): SessionV1.FilePart => ({
  id: PartID.ascending(),
  sessionID: SessionID.descending(),
  messageID: MessageID.ascending(),
  type: "file",
  mime,
  url,
})
const failing: Image.Interface = {
  normalize: () =>
    Effect.fail(new Image.SizeError({ bytes: 1, max: 0, width: 1, height: 1, max_width: 0, max_height: 0 })),
}
const unavailable: Image.Interface = { normalize: () => Effect.fail(new Image.ResizerUnavailableError()) }
const passing: Image.Interface = { normalize: (input) => Effect.succeed(input) }

describe("KiloGeneratedFile.normalize", () => {
  const run = (input: SessionV1.FilePart, image: Image.Interface, limit = Image.MAX_BASE64_BYTES) =>
    Effect.runPromise(KiloGeneratedFile.normalize(input, image, limit))

  test("keeps hosted images without decoding them", async () => {
    const input = part("image/png", "https://cdn.example.com/a.png")
    expect(await run(input, failing)).toBe(input)
  })

  test("keeps raster images when the resizer is unavailable", async () => {
    const input = part("image/png", `DATA:image/png;base64,${PNG}`)
    expect(await run(input, unavailable)).toBe(input)
  })

  test("caps non-raster inline images at the given base64 size limit", async () => {
    const small = part("image/svg+xml", "data:image/svg+xml;base64,PHN2Zy8+")
    expect(await run(small, failing, 8)).toBe(small)
    expect(await run(small, failing, 7)).toBeUndefined()
  })
})

describe("KiloGeneratedFile.store", () => {
  const ids = { sessionID: SessionID.descending(), messageID: MessageID.ascending(), id: () => PartID.ascending() }
  const files = (...items: KiloGeneratedFile.File[]) => KiloGeneratedFile.write(undefined, items)
  const png = { mime: "image/png", url: `data:image/png;base64,${PNG}` }

  test("persists normalized images without a notice", async () => {
    const parts = await Effect.runPromise(
      KiloGeneratedFile.store({ ...ids, metadata: files(png), image: passing, config: {} }),
    )
    expect(parts).toMatchObject([{ type: "file", mime: "image/png", url: png.url, filename: "image-1.png" }])
  })

  test("isolates failures and defects per image and tells the user", async () => {
    const calls = { count: 0 }
    const image: Image.Interface = {
      normalize: (input) => {
        calls.count++
        if (calls.count === 2) return Effect.die(new Error("wasm trap"))
        if (calls.count === 3) return failing.normalize(input)
        return Effect.succeed(input)
      },
    }
    const parts = await Effect.runPromise(
      KiloGeneratedFile.store({ ...ids, metadata: files(png, png, png), image, config: {} }),
    )
    expect(parts.map((item) => item.type)).toEqual(["file", "text"])
    expect(parts.at(-1)).toMatchObject({
      type: "text",
      ignored: true,
      text: "[2 generated images omitted: could not be processed within the image size limit.]",
    })
  })

  test("applies the configured image size limit to non-raster images", async () => {
    const svg = { mime: "image/svg+xml", url: "data:image/svg+xml;base64,PHN2Zy8+" }
    const kept = await Effect.runPromise(
      KiloGeneratedFile.store({ ...ids, metadata: files(svg), image: passing, config: {} }),
    )
    expect(kept.map((item) => item.type)).toEqual(["file"])
    const capped = await Effect.runPromise(
      KiloGeneratedFile.store({
        ...ids,
        metadata: files(svg),
        image: passing,
        config: { attachment: { image: { max_base64_bytes: 4 } } },
      }),
    )
    expect(capped).toMatchObject([
      { type: "text", text: "[1 generated image omitted: could not be processed within the image size limit.]" },
    ])
  })
})

describe("AI SDK adapter", () => {
  const finish = {
    type: "finish-step",
    response: { id: "r1", timestamp: new Date(0), modelId: "google/gemini-nano-banana-2.1" },
    finishReason: "stop",
    rawFinishReason: "stop",
    providerMetadata: { openrouter: { provider: "Google" } },
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: 1, reasoningTokens: undefined },
    },
  } as const

  test("carries generated images to the step-finish event and resets per step", async () => {
    const state = LLMAISDK.adapterState()
    const run = (events: Parameters<typeof LLMAISDK.toLLMEvents>[1][]) =>
      Effect.runPromise(
        Effect.forEach(events, (event) => LLMAISDK.toLLMEvents(state, event)).pipe(Effect.map((items) => items.flat())),
      )
    const file = { mediaType: "image/png", base64: PNG, uint8Array: new Uint8Array() }

    const first = await run([{ type: "file", file }, finish])
    expect(first).toHaveLength(1)
    const step = first.at(0)
    if (step?.type !== "step-finish") throw new Error("expected step-finish")
    expect(step.providerMetadata?.openrouter).toEqual({ provider: "Google" })
    expect(KiloGeneratedFile.read(step.providerMetadata)).toEqual([
      { mime: "image/png", url: `data:image/png;base64,${PNG}` },
    ])

    const second = await run([finish])
    const next = second.at(0)
    if (next?.type !== "step-finish") throw new Error("expected step-finish")
    expect(KiloGeneratedFile.read(next.providerMetadata)).toEqual([])
  })
})

// End to end: an OpenRouter-compatible stream with `delta.images` (how the Kilo Gateway
// streams Gemini "Nano Banana" output) must become an assistant file part.

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("image-model"),
}

const modes: ("text" | "image")[] = ["text", "image"]

function providerCfg(url: string) {
  return {
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@openrouter/ai-sdk-provider",
        models: {
          "image-model": {
            id: "image-model",
            name: "Image Model",
            attachment: true,
            reasoning: false,
            temperature: true,
            tool_call: true,
            release_date: "2026-01-01",
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            modalities: { input: modes, output: modes },
            options: {},
          },
        },
        options: { apiKey: "test-key", baseURL: url },
      },
    },
  }
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionProcessor.node,
      Session.node,
      SessionProjector.node,
      Provider.node,
      Database.node,
      EventV2Bridge.node,
      SessionStatus.node,
      CrossSpawnSpawner.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
    [
      [SessionSummary.node, summary],
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
    ],
  ),
)

const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
  id: "gen-1",
  model: "image-model",
  choices: [{ index: 0, delta, finish_reason: finish }],
})

it.live("persists streamed model images as assistant file parts", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const processors = yield* SessionProcessor.Service
        const session = yield* Session.Service
        const provider = yield* Provider.Service

        yield* llm.push(
          raw({
            chunks: [
              chunk({ role: "assistant", content: "Here is your image." }),
              chunk({ images: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } }] }),
              {
                ...chunk({}, "stop"),
                usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
              },
            ],
          }),
        )

        const chat = yield* session.create({})
        const parent = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: chat.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: parent.id,
          sessionID: chat.id,
          type: "text",
          text: "draw a dot",
        })
        const root = path.resolve(dir)
        const msg: SessionV1.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: chat.id,
          mode: "build",
          agent: "build",
          path: { cwd: root, root },
          cost: 0,
          tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ref.modelID,
          providerID: ref.providerID,
          parentID: parent.id,
          time: { created: Date.now() },
          finish: "end_turn",
        }
        yield* session.updateMessage(msg)
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })

        yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: ref,
          } satisfies SessionV1.User,
          sessionID: chat.id as SessionID,
          model: mdl,
          agent: {
            name: "build",
            mode: "primary",
            options: {},
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          },
          system: [],
          messages: [{ role: "user", content: "draw a dot" }],
          tools: {},
        } satisfies LLM.StreamInput)

        const parts = yield* MessageV2.parts(msg.id)
        expect(parts.some((part) => part.type === "text" && part.text === "Here is your image.")).toBe(true)
        expect(parts.filter((part) => part.type === "file")).toMatchObject([
          { type: "file", mime: "image/png", url: `data:image/png;base64,${PNG}`, filename: "image-1.png" },
        ])

        const hits = yield* llm.hits
        expect(hits.at(-1)?.body.modalities).toEqual(["image", "text"])
      }),
    { config: (url) => providerCfg(url) },
  ),
)
