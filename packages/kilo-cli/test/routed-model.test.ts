import { expect, test } from "bun:test"
import { Effect } from "effect"
import { createRoutedModelPlugin, routedModelExtractor } from "../src/routed-model-plugin"
import { responseModelID, routedModelID } from "../src/routed-model"
import { lastSettledAssistant, routedModelForAssistant } from "../src/tui-plugin/sidebar-routed-model"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode-ai/client"

type SDKEvent = {
  model: { providerID: string; id: string }
  package: string
  options: Record<string, unknown>
  sdk?: unknown
}

test("routed model parser accepts bounded response model IDs only", () => {
  expect(responseModelID({ model: "provider/actual-v1" })).toBe("provider/actual-v1")
  expect(routedModelID({ routedModelID: "provider/actual-v1" })).toBe("provider/actual-v1")
  expect(responseModelID({ model: " provider/actual" })).toBeUndefined()
  expect(responseModelID({ model: "provider/actual\u001b[31m" })).toBeUndefined()
  expect(responseModelID({ model: "x".repeat(257) })).toBeUndefined()
  expect(routedModelID({ routedModelID: "provider/actual\nnext" })).toBeUndefined()
})

test("Kilo Auto extractor composes existing metadata without changing the requested model", async () => {
  const existing = {
    async extractMetadata() {
      return { kilo: { existing: true }, retained: { value: "yes" } }
    },
    createStreamExtractor() {
      return {
        processChunk() {},
        buildMetadata() {
          return { kilo: { streaming: true }, retained: { value: "yes" } }
        },
      }
    },
  }
  const extractor = routedModelExtractor(existing)
  await expect(extractor.extractMetadata!({ parsedBody: { model: "provider/direct" } })).resolves.toEqual({
    kilo: { existing: true, routedModelID: "provider/direct" },
    retained: { value: "yes" },
  })
  const stream = extractor.createStreamExtractor!()
  stream.processChunk({ model: "provider/actual" })
  expect(stream.buildMetadata()).toEqual({
    kilo: { streaming: true, routedModelID: "provider/actual" },
    retained: { value: "yes" },
  })
})

test("Kilo Auto SDK hook preserves the requested model", async () => {
  let hook: ((event: SDKEvent) => Effect.Effect<void>) | undefined
  const plugin = createRoutedModelPlugin()
  await Effect.runPromise(
    Effect.scoped(
      plugin.effect({
        catalog: {
          transform() {
            return Effect.void
          },
        },
        aisdk: {
          hook(_name: string, callback: unknown) {
            hook = callback as typeof hook
            return Effect.void
          },
        },
      } as never),
    ),
  )
  if (!hook) throw new Error("Kilo routed-model hook was not registered")
  const event: SDKEvent = {
    model: { providerID: "kilo", id: "kilo-auto/free" },
    package: "@ai-sdk/openai-compatible/kilo",
    options: { baseURL: "http://127.0.0.1", name: "kilo" },
  }
  await Effect.runPromise(hook(event))
  expect(event.model.id).toBe("kilo-auto/free")
  expect(event.sdk).toBeDefined()
})

test("non-Auto Kilo models retain no routed-model extractor", async () => {
  let hook: ((event: SDKEvent) => Effect.Effect<void>) | undefined
  const plugin = createRoutedModelPlugin()
  await Effect.runPromise(
    Effect.scoped(
      plugin.effect({
        catalog: {
          transform() {
            return Effect.void
          },
        },
        aisdk: {
          hook(_name: string, callback: unknown) {
            hook = callback as typeof hook
            return Effect.void
          },
        },
      } as never),
    ),
  )
  if (!hook) throw new Error("Kilo routed-model hook was not registered")
  const event: SDKEvent = {
    model: { providerID: "kilo", id: "ordinary" },
    package: "@ai-sdk/openai-compatible/kilo",
    options: {},
  }
  await Effect.runPromise(hook(event))
  expect(event.sdk).toBeUndefined()
})

test("the routed hook ignores other OpenAI-compatible runtime packages", async () => {
  let hook: ((event: SDKEvent) => Effect.Effect<void>) | undefined
  const plugin = createRoutedModelPlugin()
  await Effect.runPromise(
    Effect.scoped(
      plugin.effect({
        catalog: {
          transform() {
            return Effect.void
          },
        },
        aisdk: {
          hook(_name: string, callback: unknown) {
            hook = callback as typeof hook
            return Effect.void
          },
        },
      } as never),
    ),
  )
  if (!hook) throw new Error("Kilo routed-model hook was not registered")
  const event: SDKEvent = {
    model: { providerID: "kilo", id: "kilo-auto/free" },
    package: "@ai-sdk/openai-compatible/other",
    options: {},
  }
  await Effect.runPromise(hook(event))
  expect(event.sdk).toBeUndefined()
})

test("sidebar evaluates the latest settled assistant before displaying an Auto route", () => {
  const routed = {
    type: "assistant",
    model: { providerID: "kilo", id: "kilo-auto/free" },
    time: { created: 1, completed: 2 },
    providerState: { routedModelID: "provider/actual" },
  } as unknown as SessionMessageAssistant
  const ordinary = {
    type: "assistant",
    model: { providerID: "kilo", id: "ordinary" },
    time: { created: 3, completed: 4 },
  } as unknown as SessionMessageAssistant
  const latest = lastSettledAssistant([routed, ordinary] as SessionMessageInfo[])
  expect(latest).toBe(ordinary)
  expect(routedModelForAssistant(latest)).toBeUndefined()
  expect(routedModelForAssistant(routed)).toBe("provider/actual")
})
