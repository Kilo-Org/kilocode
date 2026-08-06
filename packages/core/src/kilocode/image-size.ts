export const MAX_DIMENSION = 16_384
export const MAX_PIXELS = 25_000_000

export function dimensions(input: Buffer) {
  const png = input.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (png) {
    if (input.length < 24 || input.toString("ascii", 12, 16) !== "IHDR") throw new TypeError("invalid PNG")
    return { width: input.readUInt32BE(16), height: input.readUInt32BE(20) }
  }

  const gif = input.toString("ascii", 0, 6)
  if (gif === "GIF87a" || gif === "GIF89a") {
    if (input.length < 10) throw new TypeError("invalid GIF")
    return { width: input.readUInt16LE(6), height: input.readUInt16LE(8) }
  }

  if (input[0] === 0xff && input[1] === 0xd8) {
    for (let offset = 2; offset < input.length; ) {
      if (input[offset] !== 0xff) throw new TypeError("invalid JPEG")
      while (input[offset] === 0xff) offset++
      const marker = input[offset++]
      if (marker === undefined || marker === 0xd9 || marker === 0xda) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
      if (offset + 2 > input.length) throw new TypeError("invalid JPEG")
      const length = input.readUInt16BE(offset)
      if (length < 2 || offset + length > input.length) throw new TypeError("invalid JPEG")
      const frame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      if (frame) {
        if (length < 7) throw new TypeError("invalid JPEG")
        return { width: input.readUInt16BE(offset + 5), height: input.readUInt16BE(offset + 3) }
      }
      offset += length
    }
    throw new TypeError("invalid JPEG")
  }

  if (input.toString("ascii", 0, 4) === "RIFF" && input.toString("ascii", 8, 12) === "WEBP") {
    const chunk = input.toString("ascii", 12, 16)
    if (chunk === "VP8X" && input.length >= 30) {
      return { width: input.readUIntLE(24, 3) + 1, height: input.readUIntLE(27, 3) + 1 }
    }
    if (chunk === "VP8L" && input.length >= 25 && input[20] === 0x2f) {
      const b1 = input[21] ?? 0
      const b2 = input[22] ?? 0
      const b3 = input[23] ?? 0
      const b4 = input[24] ?? 0
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
      }
    }
    if (chunk === "VP8 " && input.length >= 30 && input[23] === 0x9d && input[24] === 0x01 && input[25] === 0x2a) {
      return { width: input.readUInt16LE(26) & 0x3fff, height: input.readUInt16LE(28) & 0x3fff }
    }
    throw new TypeError("invalid WebP")
  }

  throw new TypeError("unsupported image")
}

export function allowed(size: { width: number; height: number }) {
  return (
    size.width > 0 &&
    size.height > 0 &&
    size.width <= MAX_DIMENSION &&
    size.height <= MAX_DIMENSION &&
    size.width * size.height <= MAX_PIXELS
  )
}
