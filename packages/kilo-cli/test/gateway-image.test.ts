import { expect, test } from "bun:test"
import { ai, ImageClient } from "@opencode/ai/effect"
import { RequestExecutor } from "@opencode/ai/route"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { KiloGatewayImage } from "../src/gateway-image"

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

type Handler = (input: {
  readonly request: HttpClientRequest.HttpClientRequest
  readonly text: string
}) => Effect.Effect<HttpClientResponse.HttpClientResponse>

/** Answer every media request with the handler, read back through a real `HttpClient`. */
const httpLayer = (handler: Handler) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
        const text = yield* Effect.promise(() => web.text())
        return yield* handler({ request, text })
      }),
    ),
  )

const imageLayer = (handler: Handler) =>
  ImageClient.layer.pipe(Layer.provide(RequestExecutor.layer.pipe(Layer.provide(httpLayer(handler)))))

const respond = (request: HttpClientRequest.HttpClientRequest, body: unknown) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
  )

const model = KiloGatewayImage.model({
  id: "google/gemini-2.5-flash-image",
  baseURL: "https://gateway.test/v1",
  apiKey: "test-key",
  headers: { "x-kilocode-version": "test", "x-kilocode-organizationid": "org" },
})

test("generates on the Gateway chat completions route with an image modality", async () => {
  let seen: { url?: string; authorization?: string | null; organization?: string | null; body?: unknown } = {}
  const response = await Effect.runPromise(
    ai.image.generate({ model, prompt: "A red circle on a white background", n: 1 }).pipe(
      Effect.provide(
        imageLayer(({ request, text }) =>
          Effect.gen(function* () {
            const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
            seen = {
              url: web.url,
              authorization: web.headers.get("authorization"),
              organization: web.headers.get("x-kilocode-organizationid"),
              body: JSON.parse(text),
            }
            return respond(request, {
              choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG}` } }] } }],
            })
          }),
        ),
      ),
    ),
  )

  expect(seen.url).toBe("https://gateway.test/v1/chat/completions")
  expect(seen.authorization).toBe("Bearer test-key")
  expect(seen.organization).toBe("org")
  expect(seen.body).toEqual({
    model: "google/gemini-2.5-flash-image",
    messages: [{ role: "user", content: "A red circle on a white background" }],
    modalities: ["image", "text"],
    n: 1,
  })
  expect(response.images).toHaveLength(1)
  expect(response.image.mediaType).toBe("image/png")
  expect((response.image.source as { type: string }).type).toBe("base64")
})
