import { describe, expect, test } from "bun:test"
import * as Png from "../../src/browser/png"

function gradient(width: number, height: number, channels: 3 | 4): Png.Image {
  const data = Buffer.alloc(width * height * channels)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * channels
      data[index] = (x * 17) % 256
      data[index + 1] = (y * 23) % 256
      data[index + 2] = 140
      if (channels === 4) data[index + 3] = 255
    }
  }
  return { width, height, channels, data }
}

const pixel = (image: Png.Image, x: number, y: number) => {
  const index = (y * image.width + x) * image.channels
  return [...image.data.subarray(index, index + image.channels)]
}

describe("png codec", () => {
  test("round-trips RGB pixels", () => {
    const source = gradient(12, 9, 3)
    const decoded = Png.decode(Png.encode(source))
    expect(decoded.width).toBe(12)
    expect(decoded.height).toBe(9)
    expect(decoded.channels).toBe(3)
    expect(decoded.data.equals(source.data)).toBe(true)
  })

  test("round-trips RGBA pixels", () => {
    const source = gradient(9, 12, 4)
    const decoded = Png.decode(Png.encode(source))
    expect(decoded.channels).toBe(4)
    expect(decoded.data.equals(source.data)).toBe(true)
  })

  test("a masked box is uniform black and everything outside it is untouched", () => {
    const source = gradient(20, 20, 4)
    const decoded = Png.decode(Png.encode(source))
    Png.mask(decoded, [{ x: 4, y: 6, width: 8, height: 5 }])

    for (let y = 6; y < 11; y++) {
      for (let x = 4; x < 12; x++) expect(pixel(decoded, x, y)).toEqual([0, 0, 0, 255])
    }
    expect(pixel(decoded, 13, 6)).toEqual(pixel(source, 13, 6))
    expect(pixel(decoded, 3, 7)).toEqual(pixel(source, 3, 7))
    expect(pixel(decoded, 5, 11)).toEqual(pixel(source, 5, 11))
  })

  test("a box that runs past the image is clamped", () => {
    const image = gradient(6, 6, 3)
    Png.mask(image, [{ x: 4, y: 4, width: 100, height: 100 }])
    expect(pixel(image, 5, 5)).toEqual([0, 0, 0])
    expect(pixel(image, 3, 3)).toEqual(pixel(gradient(6, 6, 3), 3, 3))
  })

  test("a file that is not a PNG is refused rather than guessed at", () => {
    expect(() => Png.decode(Buffer.from("GIF89a"))).toThrow()
  })

  test("an out-of-scope colour type is refused", () => {
    // Palette (colour type 3) is a valid PNG, but not something Chromium screenshots produce.
    const palette = Buffer.from(Png.encode(gradient(2, 2, 3)))
    palette[25] = 3
    expect(() => Png.decode(palette)).toThrow(/colour type/)
  })

  test("interlaced input is refused", () => {
    const interlaced = Buffer.from(Png.encode(gradient(2, 2, 3)))
    interlaced[28] = 1
    expect(() => Png.decode(interlaced)).toThrow(/interlaced/)
  })
})
