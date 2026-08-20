// kilocode_change - new file
import type { ModelMessage } from "ai"

export const MAX_BYTES = 3 * 1024 * 1024

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

export function within(messages: ModelMessage[]) {
  return encodedBytes(messages) <= MAX_BYTES
}
