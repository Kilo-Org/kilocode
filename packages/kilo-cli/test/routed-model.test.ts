import { expect, test } from "bun:test"
import { Effect } from "effect"
import { createRoutedModelPlugin } from "../src/routed-model-plugin"
import { routedModelID } from "../src/routed-model"
import { lastSettledAssistant, routedModelForAssistant } from "../src/tui-plugin/sidebar-routed-model"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode-ai/client"

test("routed model parser accepts bounded durable model IDs only", () => {
  expect(routedModelID({ routedModelID: "provider/actual-v1" })).toBe("provider/actual-v1")
  expect(routedModelID({ routedModelID: "provider/actual\nnext" })).toBeUndefined()
  expect(routedModelID({ routedModelID: "x".repeat(257) })).toBeUndefined()
  expect(routedModelID({})).toBeUndefined()
})

test("Kilo Auto uses the native routed OpenRouter package", async () => {
  const auto = { id: "kilo-auto/free", package: "aisdk:@openrouter/ai-sdk-provider" }
  const ordinary = { id: "ordinary", package: "aisdk:@openrouter/ai-sdk-provider" }
  const plugin = createRoutedModelPlugin()
  await Effect.runPromise(
    Effect.scoped(
      plugin.effect({
        catalog: {
          transform(callback: (catalog: unknown) => void) {
            callback({
              provider: {
                list: () => [
                  {
                    provider: { id: "kilo" },
                    models: new Map([
                      [auto.id, auto],
                      [ordinary.id, ordinary],
                    ]),
                  },
                ],
              },
              model: {
                update(_providerID: string, modelID: string, update: (draft: typeof auto) => void) {
                  if (modelID === auto.id) update(auto)
                  if (modelID === ordinary.id) update(ordinary)
                },
              },
            })
            return Effect.void
          },
        },
      } as never),
    ),
  )
  expect(auto.package).toBe(import.meta.resolve("@opencode-ai/ai/kilocode/openrouter-routed"))
  expect(ordinary.package).toBe("aisdk:@openrouter/ai-sdk-provider")
})

test("compatible Kilo Auto uses the native routed OpenAI-compatible package", async () => {
  const auto = { id: "kilo-auto/compatible", package: "aisdk:@ai-sdk/openai-compatible" }
  const ordinary = { id: "ordinary", package: "aisdk:@ai-sdk/openai-compatible" }
  const plugin = createRoutedModelPlugin()
  await Effect.runPromise(
    Effect.scoped(
      plugin.effect({
        catalog: {
          transform(callback: (catalog: unknown) => void) {
            callback({
              provider: {
                list: () => [
                  {
                    provider: { id: "kilo", package: "aisdk:@ai-sdk/openai-compatible" },
                    models: new Map([
                      [auto.id, auto],
                      [ordinary.id, ordinary],
                    ]),
                  },
                ],
              },
              model: {
                update(_providerID: string, modelID: string, update: (draft: typeof auto) => void) {
                  if (modelID === auto.id) update(auto)
                  if (modelID === ordinary.id) update(ordinary)
                },
              },
            })
            return Effect.void
          },
        },
      } as never),
    ),
  )
  expect(auto.package).toBe(import.meta.resolve("@opencode-ai/ai/kilocode/openai-compatible-routed"))
  expect(ordinary.package).toBe("aisdk:@ai-sdk/openai-compatible")
})

test("the catalog transform leaves an explicitly configured Auto package alone", async () => {
  const auto = { id: "kilo-auto/free", package: "configured:explicit" }
  const plugin = createRoutedModelPlugin()
  await Effect.runPromise(
    Effect.scoped(
      plugin.effect({
        catalog: {
          transform(callback: (catalog: unknown) => void) {
            callback({
              provider: {
                list: () => [
                  {
                    provider: { id: "kilo", package: "aisdk:@ai-sdk/openai-compatible" },
                    models: new Map([[auto.id, auto]]),
                  },
                ],
              },
              model: {
                update(_providerID: string, modelID: string, update: (draft: typeof auto) => void) {
                  if (modelID === auto.id) update(auto)
                },
              },
            })
            return Effect.void
          },
        },
      } as never),
    ),
  )
  expect(auto.package).toBe("configured:explicit")
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
