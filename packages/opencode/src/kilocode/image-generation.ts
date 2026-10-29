import { Effect, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { Config } from "@/config/config"
import { runner } from "./tool/host"

export function source(cfg: Config.Info) {
  const base = cfg.experimental?.image_generation_base_url?.trim()
  if (!base) return undefined
  const url = new URL(base)
  if (!["http:", "https:"].includes(url.protocol) || url.search || url.hash || url.username || url.password)
    throw new Error("Image generation base URL must be an HTTP(S) URL without credentials, query, or fragment")
  return {
    url: base.replace(/\/+$/, ""),
    key: cfg.experimental?.image_generation_api_key?.trim(),
    model: cfg.experimental?.image_generation_model?.trim() || undefined,
  }
}

const Response = Schema.Struct({ data: Schema.Array(Schema.Struct({ b64_json: Schema.String })) })
const run = runner(() => new Error("Image generation cancelled"))

export function generate(
  http: HttpClient.HttpClient,
  target: NonNullable<ReturnType<typeof source>>,
  input: {
    prompt: string
    model?: string
    image?: { bytes: Uint8Array; mime: string; name: string }
    signal: AbortSignal
  },
) {
  if (input.signal.aborted) return Effect.fail(new Error("Image generation cancelled"))
  return run(
    Effect.gen(function* () {
      const fields = { prompt: input.prompt, ...(input.model ? { model: input.model } : {}), n: 1 }
      const form = new FormData()
      if (input.image) {
        for (const [key, value] of Object.entries(fields)) form.set(key, String(value))
        form.set("image", new Blob([new Uint8Array(input.image.bytes)], { type: input.image.mime }), input.image.name)
      }
      const request = HttpClientRequest.post(`${target.url}/images/${input.image ? "edits" : "generations"}`).pipe(
        HttpClientRequest.setHeaders(target.key ? { Authorization: `Bearer ${target.key}` } : {}),
        input.image
          ? HttpClientRequest.bodyFormData(form)
          : HttpClientRequest.bodyText(JSON.stringify(fields), "application/json"),
      )
      const options = { timeout: false, redirect: "manual" as const }
      const res = yield* http.execute(request).pipe(Effect.provideService(FetchHttpClient.RequestInit, options))
      if (res.status < 200 || res.status >= 300)
        return yield* Effect.fail(
          new Error(`Image generation failed (HTTP ${res.status}): ${(yield* res.text).slice(0, 500)}`),
        )
      const result = (yield* Schema.decodeUnknownEffect(Response)(yield* res.json)).data.at(0)
      if (!result?.b64_json) throw new Error("The image endpoint must return an image in data[].b64_json")
      const bytes = Buffer.from(result.b64_json, "base64")
      const format = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? ("png" as const)
        : bytes.at(0) === 255 && bytes.at(1) === 216 && bytes.at(2) === 255
          ? ("jpeg" as const)
          : undefined
      if (!format) throw new Error("The image endpoint must return PNG or JPEG image data")
      return { format, base64: result.b64_json }
    }).pipe(Effect.timeout("15 minutes")),
    input.signal,
  )
}
