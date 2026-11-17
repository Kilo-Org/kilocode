/**
 * Minimal PNG codec for screenshot masking on the Playwright backend.
 *
 * Playwright screenshots are 8-bit, non-interlaced PNGs whose colour type is RGB
 * or RGBA. That is the whole supported surface: anything else is refused rather
 * than guessed at, so a screenshot that cannot be masked returns no image.
 */
import { deflateSync, inflateSync } from "node:zlib"

export type Image = { width: number; height: number; channels: 3 | 4; data: Buffer }
export type Box = { x: number; y: number; width: number; height: number }

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(parts: readonly Buffer[]) {
  let c = 0xffffffff
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) c = CRC[(c ^ part[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, body: Buffer) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  const name = Buffer.from(type, "ascii")
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc32([name, body]))
  return Buffer.concat([length, name, body, sum])
}

/** Decode a PNG into 8-bit RGB(A) pixels. Throws when the file is out of scope. */
export function decode(png: Buffer): Image {
  if (
    png.length < 8 ||
    !png.subarray(0, 8).equals(SIGNATURE) ||
    png.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("not a PNG image")
  }
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const depth = png[24]
  const color = png[25]
  const interlace = png[28]
  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth}`)
  if (color !== 2 && color !== 6) throw new Error(`unsupported PNG colour type ${color}`)
  if (interlace !== 0) throw new Error("interlaced PNG is not supported")
  const channels = color === 6 ? 4 : 3

  const parts: Buffer[] = []
  let offset = 8
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString("ascii")
    if (type === "IDAT") parts.push(png.subarray(offset + 8, offset + 8 + length))
    if (type === "IEND") break
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(parts))
  const stride = width * channels
  const data = Buffer.alloc(stride * height)
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = data.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[x - channels] : 0
      const up = previous[x]
      const corner = x >= channels ? previous[x - channels] : 0
      const value = line[x]
      switch (filter) {
        case 0:
          out[x] = value
          break
        case 1:
          out[x] = (value + left) & 0xff
          break
        case 2:
          out[x] = (value + up) & 0xff
          break
        case 3:
          out[x] = (value + ((left + up) >> 1)) & 0xff
          break
        case 4: {
          const estimate = left + up - corner
          const dl = Math.abs(estimate - left)
          const du = Math.abs(estimate - up)
          const dc = Math.abs(estimate - corner)
          const paeth = dl <= du && dl <= dc ? left : du <= dc ? up : corner
          out[x] = (value + paeth) & 0xff
          break
        }
        default:
          throw new Error(`unsupported PNG filter ${filter}`)
      }
    }
    previous = out
  }
  return { width, height, channels, data }
}

/** Encode 8-bit RGB(A) pixels as a non-interlaced PNG. */
export function encode(image: Image): Buffer {
  const stride = image.width * image.channels
  const raw = Buffer.alloc((stride + 1) * image.height)
  for (let y = 0; y < image.height; y++) {
    raw[y * (stride + 1)] = 0
    image.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(image.width, 0)
  header.writeUInt32BE(image.height, 4)
  header[8] = 8
  header[9] = image.channels === 4 ? 6 : 2
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

/** Fill every pixel inside `boxes` with black, clamped to the image bounds. */
export function mask(image: Image, boxes: readonly Box[]): Image {
  for (const box of boxes) {
    const left = Math.max(0, Math.floor(box.x))
    const top = Math.max(0, Math.floor(box.y))
    const right = Math.min(image.width, Math.ceil(box.x + box.width))
    const bottom = Math.min(image.height, Math.ceil(box.y + box.height))
    for (let y = top; y < bottom; y++) {
      const row = y * image.width * image.channels
      for (let x = left; x < right; x++) {
        const index = row + x * image.channels
        image.data[index] = 0
        image.data[index + 1] = 0
        image.data[index + 2] = 0
        if (image.channels === 4) image.data[index + 3] = 255
      }
    }
  }
  return image
}
