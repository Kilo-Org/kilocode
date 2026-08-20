// kilocode_change - new file
import { Effect } from "effect"
import { Image } from "../../image"
import type { SessionMessage } from "../../session/message"

export const MAX_BYTES = 3 * 1024 * 1024

function data(uri: string) {
  const index = uri.indexOf(";base64,")
  if (!uri.startsWith("data:") || index === -1) return undefined
  return uri.slice(index + ";base64,".length)
}

export const normalize = Effect.fn("SessionMedia.normalize")(function* (messages: readonly SessionMessage.Message[]) {
  const image = yield* Image.Service
  return yield* Effect.forEach(messages, (message) => {
    if (message.type !== "user" || message.files === undefined) return Effect.succeed(message)
    return Effect.forEach(message.files, (file) => {
      if (!file.mime.startsWith("image/")) return Effect.succeed(file)
      const content = data(file.uri)
      if (content === undefined) return Effect.succeed(file)
      return image
        .normalize(file.uri, {
          uri: file.uri,
          name: file.name,
          content,
          encoding: "base64",
          mime: file.mime,
        })
        .pipe(
          Effect.map((result) => ({
            ...file,
            mime: result.mime,
            uri: `data:${result.mime};base64,${result.content}`,
          })),
          Effect.orDie,
        )
    }).pipe(Effect.map((files) => ({ ...message, files })))
  })
})

function media(parent: unknown, key: string) {
  if (!parent || typeof parent !== "object" || !("type" in parent)) return false
  if (String(parent.type) === "image") return key === "image"
  if (!("mediaType" in parent) || typeof parent.mediaType !== "string") return false
  return (
    (String(parent.type) === "file" || String(parent.type) === "media") &&
    parent.mediaType.startsWith("image/") &&
    (key === "data" || key === "url")
  )
}

function size(value: unknown) {
  if (value instanceof Uint8Array) return Math.ceil(value.byteLength / 3) * 4
  if (typeof value !== "string") return 0
  const index = value.indexOf(",")
  const encoded = index !== -1 && value.slice(0, index).includes(";base64,") ? value.slice(index + 1) : value
  return Buffer.byteLength(encoded, "utf8")
}

export function encodedBytes(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((total, item) => total + encodedBytes(item), 0)
  if (!value || typeof value !== "object") return 0
  return Object.entries(value).reduce(
    (total, [key, item]) => total + (media(value, key) ? size(item) : encodedBytes(item)),
    0,
  )
}
