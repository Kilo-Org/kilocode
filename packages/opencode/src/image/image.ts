import { Config } from "@/config/config"
import type { MessageV2 } from "@/session/message-v2"
import * as Log from "@opencode-ai/core/util/log"
import photonWasm from "@silvia-odwyer/photon-node/photon_rs_bg.wasm" with { type: "file" }
import { Context, Effect, Layer, Schema } from "effect"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const MAX_BASE64_BYTES = 5 * 1024 * 1024 // kilocode_change - share user file pre-read limit
const MAX_WIDTH = 2000
const MAX_HEIGHT = 2000
const AUTO_RESIZE = true
const JPEG_QUALITIES = [80, 85, 70, 55, 40]
const log = Log.create({ service: "image" })

// kilocode_change start - preserve valid in-limit images when Photon is unavailable
function dimensions(mime: string, data: Buffer) {
  if (
    mime === "image/png" &&
    data.length >= 24 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    data.subarray(12, 16).toString("ascii") === "IHDR"
  )
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }

  if (mime === "image/gif" && data.length >= 10) {
    const head = data.subarray(0, 6).toString("ascii")
    if (head === "GIF87a" || head === "GIF89a") return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) }
  }

  if ((mime === "image/jpeg" || mime === "image/jpg") && data.length >= 4 && data.readUInt16BE(0) === 0xffd8) {
    for (let offset = 2; offset + 8 < data.length; ) {
      if (data[offset] !== 0xff) {
        offset++
        continue
      }
      const marker = data[offset + 1]
      if (marker === 0xd9 || marker === 0xda) break
      const length = data.readUInt16BE(offset + 2)
      if (length < 2 || offset + length + 2 > data.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
        return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) }
      offset += length + 2
    }
  }

  if (
    mime === "image/webp" &&
    data.length >= 30 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    const chunk = data.subarray(12, 16).toString("ascii")
    if (chunk === "VP8X")
      return {
        width: 1 + data.readUIntLE(24, 3),
        height: 1 + data.readUIntLE(27, 3),
      }
    if (chunk === "VP8L" && data[20] === 0x2f)
      return {
        width: 1 + data[21] + ((data[22] & 0x3f) << 8),
        height: 1 + (data[22] >> 6) + (data[23] << 2) + ((data[24] & 0x0f) << 10),
      }
    if (chunk === "VP8 " && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a)
      return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff }
  }
}

export function fallback(
  input: MessageV2.FilePart,
  base64: string,
  max: { bytes: number; width: number; height: number },
) {
  const bytes = Buffer.byteLength(base64, "utf8")
  if (bytes > max.bytes)
    return new SizeError({
      bytes,
      max: max.bytes,
      width: 0,
      height: 0,
      max_width: max.width,
      max_height: max.height,
    })
  const data = Buffer.from(base64, "base64")
  const canonical = data.toString("base64").replace(/=+$/, "") === base64.replace(/=+$/, "")
  const size = canonical ? dimensions(input.mime, data) : undefined
  if (!base64 || !size) return new DecodeError()
  if (size.width > max.width || size.height > max.height)
    return new SizeError({
      bytes,
      max: max.bytes,
      width: size.width,
      height: size.height,
      max_width: max.width,
      max_height: max.height,
    })
  return input
}
// kilocode_change end

export class ResizerUnavailableError extends Schema.TaggedErrorClass<ResizerUnavailableError>()(
  "ImageResizerUnavailableError",
  {},
) {
  override get message() {
    return "Image resizer is unavailable"
  }
}

export class InvalidDataUrlError extends Schema.TaggedErrorClass<InvalidDataUrlError>()("ImageInvalidDataUrlError", {
  url: Schema.String,
}) {
  override get message() {
    return "Image URL must be a base64 data URL"
  }
}

export class DecodeError extends Schema.TaggedErrorClass<DecodeError>()("ImageDecodeError", {}) {
  override get message() {
    return "Image could not be decoded"
  }
}

export class SizeError extends Schema.TaggedErrorClass<SizeError>()("ImageSizeError", {
  bytes: Schema.Number,
  max: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  max_width: Schema.Number,
  max_height: Schema.Number,
}) {
  override get message() {
    return `Image ${this.width}x${this.height} with base64 size ${this.bytes} exceeds configured limits and could not be resized below ${this.max_width}x${this.max_height}/${this.max} bytes`
  }
}

export type Error = ResizerUnavailableError | InvalidDataUrlError | DecodeError | SizeError

export interface Interface {
  readonly normalize: (input: MessageV2.FilePart) => Effect.Effect<MessageV2.FilePart, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Image") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const loadPhoton = yield* Effect.cached(
      Effect.sync(() => {
        const wasm = path.isAbsolute(photonWasm) ? photonWasm : fileURLToPath(new URL(photonWasm, import.meta.url))
        ;(globalThis as typeof globalThis & { __OPENCODE_PHOTON_WASM_PATH?: string }).__OPENCODE_PHOTON_WASM_PATH = wasm
        ;(globalThis as typeof globalThis & { __KILOCODE_PHOTON_WASM_PATH?: string }).__KILOCODE_PHOTON_WASM_PATH = wasm
      }).pipe(
        Effect.andThen(() => Effect.tryPromise(() => import("@silvia-odwyer/photon-node"))),
        Effect.tapError((error) => Effect.sync(() => log.warn("failed to load photon", { error }))),
        Effect.mapError(() => new ResizerUnavailableError()),
      ),
    )

    const normalize = Effect.fn("Image.normalize")(function* (input: MessageV2.FilePart) {
      const image = (yield* config.get()).attachment?.image
      const info = {
        autoResize: image?.auto_resize ?? AUTO_RESIZE,
        maxWidth: image?.max_width ?? MAX_WIDTH,
        maxHeight: image?.max_height ?? MAX_HEIGHT,
        maxBase64Bytes: image?.max_base64_bytes ?? MAX_BASE64_BYTES,
      }
      if (!input.url.startsWith("data:") || !input.url.includes(";base64,"))
        return yield* new InvalidDataUrlError({ url: input.url })

      const base64 = input.url.slice(input.url.indexOf(";base64,") + ";base64,".length)
      const bytes = Buffer.byteLength(base64, "utf8")
      const photon = yield* loadPhoton.pipe(
        Effect.catchTag("ImageResizerUnavailableError", () => {
          const result = fallback(input, base64, {
            bytes: info.maxBase64Bytes,
            width: info.maxWidth,
            height: info.maxHeight,
          })
          return result instanceof Error ? Effect.fail(result) : Effect.succeed(undefined)
        }),
      )
      if (!photon) return input

      const decoded = yield* Effect.try({
        try: () => photon.PhotonImage.new_from_byteslice(Buffer.from(base64, "base64")),
        catch: (error) => {
          log.warn("failed to decode image", { error })
          return new DecodeError()
        },
      })

      try {
        const originalWidth = decoded.get_width()
        const originalHeight = decoded.get_height()
        if (originalWidth <= info.maxWidth && originalHeight <= info.maxHeight && bytes <= info.maxBase64Bytes)
          return input
        if (!info.autoResize)
          return yield* new SizeError({
            bytes,
            max: info.maxBase64Bytes,
            width: originalWidth,
            height: originalHeight,
            max_width: info.maxWidth,
            max_height: info.maxHeight,
          })

        const scale = Math.min(1, info.maxWidth / originalWidth, info.maxHeight / originalHeight)
        for (const size of Array.from({ length: 32 }).reduce<Array<{ width: number; height: number }>>((acc) => {
          const previous = acc.at(-1) ?? {
            width: Math.max(1, Math.round(originalWidth * scale)),
            height: Math.max(1, Math.round(originalHeight * scale)),
          }
          const next =
            acc.length === 0
              ? previous
              : {
                  width: previous.width === 1 ? 1 : Math.max(1, Math.floor(previous.width * 0.75)),
                  height: previous.height === 1 ? 1 : Math.max(1, Math.floor(previous.height * 0.75)),
                }
          return acc.some((item) => item.width === next.width && item.height === next.height) ? acc : [...acc, next]
        }, [])) {
          const resized = photon.resize(decoded, size.width, size.height, photon.SamplingFilter.Lanczos3)
          const candidate = [
            { data: Buffer.from(resized.get_bytes()).toString("base64"), mime: "image/png" },
            ...JPEG_QUALITIES.map((quality) => ({
              data: Buffer.from(resized.get_bytes_jpeg(quality)).toString("base64"),
              mime: "image/jpeg",
            })),
          ]
            .map((item) => ({ ...item, bytes: Buffer.byteLength(item.data, "utf8") }))
            .find((item) => item.bytes <= info.maxBase64Bytes)
          resized.free()

          if (candidate) {
            log.info("using resized image", {
              from_mime: input.mime,
              to_mime: candidate.mime,
              from: `${originalWidth}x${originalHeight}`,
              to: `${size.width}x${size.height}`,
            })
            return {
              ...input,
              mime: candidate.mime,
              url: `data:${candidate.mime};base64,${candidate.data}`,
            }
          }
        }

        return yield* new SizeError({
          bytes,
          max: info.maxBase64Bytes,
          width: originalWidth,
          height: originalHeight,
          max_width: info.maxWidth,
          max_height: info.maxHeight,
        })
      } finally {
        decoded.free()
      }
    })

    return Service.of({ normalize })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export * as Image from "./image"
