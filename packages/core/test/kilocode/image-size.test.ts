import { describe, expect, test } from "bun:test"
import { allowed, dimensions, MAX_DIMENSION, MAX_PIXELS } from "../../src/kilocode/image-size"

describe("image header dimensions", () => {
  test("reads supported formats without decoding pixels", () => {
    const png = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png)
    png.write("IHDR", 12, "ascii")
    png.writeUInt32BE(32, 16)
    png.writeUInt32BE(16, 20)

    const gif = Buffer.alloc(10)
    gif.write("GIF89a", 0, "ascii")
    gif.writeUInt16LE(32, 6)
    gif.writeUInt16LE(16, 8)

    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xc2, 0x00, 0x07, 0x08, 0x00, 0x10, 0x00, 0x20])

    const webp = Buffer.alloc(30)
    webp.write("RIFF", 0, "ascii")
    webp.write("WEBP", 8, "ascii")
    webp.write("VP8X", 12, "ascii")
    webp.writeUIntLE(31, 24, 3)
    webp.writeUIntLE(15, 27, 3)

    for (const input of [png, gif, jpg, webp]) expect(dimensions(input)).toEqual({ width: 32, height: 16 })
  })

  test("rejects unsafe native allocations", () => {
    expect(allowed({ width: 6_000, height: 4_000 })).toBe(true)
    expect(allowed({ width: MAX_DIMENSION + 1, height: 1 })).toBe(false)
    expect(allowed({ width: MAX_PIXELS, height: 2 })).toBe(false)
  })

  test("rejects incomplete headers", () => {
    expect(() => dimensions(Buffer.from("not an image"))).toThrow()
  })
})
