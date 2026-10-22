import { createReadStream } from "fs"
import * as path from "path"
import type { DiffImage, DiffImageSide } from "../types"

const MIMES: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpe": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
}

export const MAX_IMAGE_BYTES = 5_000_000

export interface DiffImageSource {
  bytes: number
  read: () => Promise<Buffer | undefined>
}

export function imageMime(file: string): string | undefined {
  return MIMES[path.extname(file).toLowerCase()]
}

export function encodeImageSide(mime: string, data: Buffer | undefined, bytes = data?.byteLength ?? 0): DiffImageSide {
  if (bytes > MAX_IMAGE_BYTES) return { mime, bytes, error: "too-large" }
  if (!data || data.byteLength === 0) return { mime, bytes, error: "unreadable" }
  if (data.byteLength > MAX_IMAGE_BYTES) return { mime, bytes: data.byteLength, error: "too-large" }
  return { mime, bytes: data.byteLength, data: data.toString("base64") }
}

export function readImageFile(file: string): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let bytes = 0
    const stream = createReadStream(file, { end: MAX_IMAGE_BYTES, highWaterMark: 64 * 1024 })
    stream.on("data", (chunk) => {
      const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk
      chunks.push(data)
      bytes += data.byteLength
    })
    stream.on("error", () => resolve(undefined))
    stream.on("end", () => resolve(Buffer.concat(chunks, bytes)))
  })
}

async function load(mime: string, source: DiffImageSource): Promise<DiffImageSide> {
  if (source.bytes > MAX_IMAGE_BYTES) return { mime, bytes: source.bytes, error: "too-large" }
  const data = await source.read().catch(() => undefined)
  return encodeImageSide(mime, data, source.bytes)
}

export async function loadImage(
  file: string,
  before?: DiffImageSource,
  after?: DiffImageSource,
): Promise<DiffImage | undefined> {
  const mime = imageMime(file)
  if (!mime) return undefined
  const [left, right] = await Promise.all([
    before ? load(mime, before) : undefined,
    after ? load(mime, after) : undefined,
  ])
  return { before: left, after: right }
}
