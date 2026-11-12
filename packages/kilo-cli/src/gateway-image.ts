// Image generation through the Kilo Gateway, which serves image models on its OpenRouter-style chat completions route
// (`modalities: ["image", "text"]`) and rejects an images API path. The core media resolver builds Kilo image models
// from a provider package, so the Kilo host redirects them here, where the Gateway's own contract is available.
export * as KiloGatewayImage from "./gateway-image"

import { ImageModel, ImageResponse, Media, type ImageRequest } from "@opencode/ai"
import { AuthOptions, MediaProtocol, ProviderShared } from "@opencode/ai/route"
import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"

const route = MediaProtocol.identity({ id: "kilo-chat-images", name: "Kilo Gateway Images", provider: "kilo" })
const path = "/chat/completions"

const ResponseBody = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({
        images: Schema.optional(Schema.Array(Schema.Struct({ image_url: Schema.Struct({ url: Schema.String }) }))),
      }),
    }),
  ),
})

const fromRequest = Effect.fn("KiloGatewayImage.fromRequest")(function* (request: ImageRequest) {
  // Input images are edits or references, which the Gateway takes as chat image parts, in order.
  const references = yield* Effect.forEach(request.images ?? [], (image) =>
    ProviderShared.mediaReference(image, undefined, route.name),
  )
  const content =
    references.length === 0
      ? request.prompt
      : [
          { type: "text", text: request.prompt },
          ...references.map((item) => ({ type: "image_url", image_url: { url: item.value } })),
        ]
  return MediaProtocol.json({
    model: request.model.id,
    messages: [{ role: "user", content }],
    modalities: ["image", "text"],
    ...(request.n === undefined ? {} : { n: request.n }),
    ...request.http?.body,
  })
})

const decodeDocument = route.decodeJson(ResponseBody)

const decodeResponse = Effect.fn("KiloGatewayImage.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  const output = yield* decodeDocument(response)
  const items = output.value.choices.flatMap((choice) => choice.message.images ?? [])
  const images = yield* Effect.forEach(items, (item) => {
    const dataUrl = Media.parseDataUrl(item.image_url.url)
    if (dataUrl) return Effect.succeed(dataUrl)
    if (/^https?:\/\//i.test(item.image_url.url)) return Effect.succeed(Media.url(item.image_url.url))
    return Effect.fail(output.invalid(`${route.name} returned an invalid image reference`))
  })
  if (images.length === 0) return yield* output.invalid(`${route.name} returned no images`)
  return new ImageResponse({ images })
})

export const protocol = MediaProtocol.inline<ImageRequest, ImageResponse>(route, {
  body: { from: fromRequest },
  response: { decode: decodeResponse },
})

export interface ModelOptions {
  readonly id: string
  readonly baseURL: string
  readonly apiKey?: string
  readonly headers?: Record<string, string>
}

export function model(input: ModelOptions) {
  return ImageModel.fromRoute(
    { protocol, baseURL: input.baseURL, path },
    {
      id: input.id,
      auth: AuthOptions.bearer({ apiKey: input.apiKey }, "KILO_API_KEY"),
      headers: input.headers,
    },
  )
}
