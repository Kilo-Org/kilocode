// The parseImage tests of v1 `tests/unit/image-preview.test.ts`.
import { describe, expect, test } from "bun:test"
import { parseImage } from "../src/image-preview"

describe("parseImage", () => {
  test("parses png data urls and preserves a clean extension", () => {
    const img = parseImage("data:image/png;base64,aGVsbG8=", "screen")

    expect(img?.name).toBe("screen.png")
    expect(img?.ext).toBe("png")
    expect(Buffer.from(img?.data ?? []).toString("utf8")).toBe("hello")
  })

  test("sanitizes the basename and keeps the existing extension", () => {
    const img = parseImage("data:image/jpeg;base64,aGVsbG8=", "../../bad name!!.jpeg")

    expect(img?.name).toBe("bad-name.jpeg")
    expect(img?.ext).toBe("jpg")
  })

  test("returns null for non-image data urls", () => {
    expect(parseImage("data:text/plain;base64,aGVsbG8=", "note.txt")).toBeNull()
  })

  test("returns null when the header is not base64", () => {
    expect(parseImage("data:image/png,hello", "screen.png")).toBeNull()
  })
})
