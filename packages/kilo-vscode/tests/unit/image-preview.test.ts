import { describe, expect, it } from "bun:test"
import { buildPreviewPath, getPreviewCommand, getPreviewDir, parseImage, trimEntries } from "../../src/image-preview"

describe("parseImage", () => {
  it("parses png data urls and preserves a clean extension", () => {
    const img = parseImage("data:image/png;base64,aGVsbG8=", "screen")

    expect(img).not.toBeNull()
    expect(img?.name).toBe("screen.png")
    expect(img?.ext).toBe("png")
    expect(Buffer.from(img?.data ?? []).toString("utf8")).toBe("hello")
  })

  it("sanitizes the basename and keeps the existing extension", () => {
    const img = parseImage("data:image/jpeg;base64,aGVsbG8=", "../../bad name!!.jpeg")

    expect(img).not.toBeNull()
    expect(img?.name).toBe("bad-name.jpeg")
    expect(img?.ext).toBe("jpg")
  })

  it("returns null for non-image data urls", () => {
    expect(parseImage("data:text/plain;base64,aGVsbG8=", "note.txt")).toBeNull()
  })

  it("returns null when the header is not base64", () => {
    expect(parseImage("data:image/png,hello", "screen.png")).toBeNull()
  })
})

describe("buildPreviewPath", () => {
  it("writes previews into a dedicated storage folder", () => {
    expect(buildPreviewPath("screen.png", 42)).toBe("image-preview/42-screen.png")
  })
})

describe("getPreviewDir", () => {
  it("returns the preview storage folder", () => {
    expect(getPreviewDir()).toBe("image-preview")
  })
})

describe("trimEntries", () => {
  it("drops the oldest preview paths once the limit is exceeded", () => {
    const items = Array.from({ length: 22 }, (_, i) => ({ path: `${String(i).padStart(2, "0")}-screen.png` }))

    expect(trimEntries(items)).toEqual(["00-screen.png", "01-screen.png"])
  })

  it("keeps all preview paths when below the limit", () => {
    expect(trimEntries([{ path: "01-screen.png" }])).toEqual([])
  })
})

describe("getPreviewCommand", () => {
  it("targets the built-in preview editor with explicit sizing", () => {
    const uri = { toString: () => "file:///tmp/screen.png" }

    expect(getPreviewCommand(uri)).toEqual(["imagePreview.previewEditor", { resource: uri, size: "contain" }])
  })
})
