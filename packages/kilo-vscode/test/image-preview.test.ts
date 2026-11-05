import { describe, expect, test } from "bun:test"
import { buildPreviewPath, getPreviewCommand, getPreviewDir, parseImage, trimEntries } from "../src/image-preview"

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

describe("preview files", () => {
  test("writes previews into a dedicated storage folder", () => {
    expect(getPreviewDir()).toBe("image-preview")
    expect(buildPreviewPath("screen.png", 42)).toBe("image-preview/42-screen.png")
  })

  test("opens the built-in image preview editor", () => {
    const uri = { toString: () => "file:///storage/image-preview/42-screen.png" }
    expect(getPreviewCommand(uri)).toEqual(["imagePreview.previewEditor", { resource: uri, size: "contain" }])
  })

  test("drops the oldest preview paths once the limit is exceeded", () => {
    const items = Array.from({ length: 22 }, (_, i) => ({ path: `${String(i).padStart(2, "0")}-screen.png` }))
    expect(trimEntries(items)).toEqual(["00-screen.png", "01-screen.png"])
  })

  test("keeps all preview paths when below the limit", () => {
    expect(trimEntries([{ path: "01-screen.png" }])).toEqual([])
  })
})
