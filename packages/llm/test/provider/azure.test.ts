// kilocode_change - new file
import { describe, expect } from "bun:test"
import { HttpClientRequest } from "effect/unstable/http"
import { Effect } from "effect"
import { LLM } from "../../src"
import * as Azure from "../../src/providers/azure"
import { it } from "../lib/effect"
import { dynamicResponse } from "../lib/http"
import { sseEvents } from "../lib/sse"

const deltaChunk = (delta: object, finishReason: string | null = null) => ({
  id: "chatcmpl_fixture",
  choices: [{ delta, finish_reason: finishReason }],
  usage: null,
})

describe("Azure", () => {
  it.effect("accepts a resource name as the single host label", () =>
    Effect.gen(function* () {
      const model = Azure.configure({ apiKey: "azure-key", resourceName: "my-resource" }).chat("deployment")

      expect(model).toMatchObject({ id: "deployment", provider: "azure" })
      expect(model.route.endpoint.baseURL).toBe("https://my-resource.openai.azure.com/openai/v1")

      yield* LLM.generate(LLM.request({ model, prompt: "Say hello." })).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.gen(function* () {
              const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
              expect(web.url).toBe("https://my-resource.openai.azure.com/openai/v1/chat/completions?api-version=v1")
              expect(web.headers.get("api-key")).toBe("azure-key")
              return input.respond(sseEvents(deltaChunk({}, "stop")), {
                headers: { "content-type": "text/event-stream" },
              })
            }),
          ),
        ),
      )
    }),
  )

  it.effect("requires a plain resource name", () =>
    Effect.gen(function* () {
      const names = [
        "proxy.example/",
        "proxy.example",
        "resource@proxy.example",
        "resource?x",
        "resource#x",
        "resource:8080",
        "https://proxy.example",
        "my resource",
        "",
      ]

      for (const resourceName of names) {
        expect(() => Azure.configure({ apiKey: "azure-key", resourceName }).responses("deployment")).toThrow(
          /Invalid Azure resource name/,
        )
      }
    }),
  )

  it.effect("keeps an explicit baseURL working", () =>
    Effect.gen(function* () {
      const model = Azure.configure({
        apiKey: "azure-key",
        baseURL: "https://proxy.example.com/openai",
        resourceName: "ignored-when-baseURL-wins",
      }).chat("deployment")

      expect(model.route.endpoint.baseURL).toBe("https://proxy.example.com/openai")
    }),
  )
})
