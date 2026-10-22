import { describe, expect, it } from "bun:test"
import { buildPreviewPath, getPreviewCommand, getPreviewDir, parseImage, trimEntries } from "../../src/image-preview"
import { imageMime } from "../../src/shared/image-data-url"

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

// The webview decides whether to route a click to the host preview or keep
// its own modal fallback by asking imageMime, so the two must agree on every
// url: a url imageMime accepts but parseImage rejects would open nothing.
describe("imageMime", () => {
  it("accepts exactly the urls parseImage can decode", () => {
    const urls = [
      "data:image/png;base64,aGVsbG8=",
      "data:image/svg+xml;base64,aGVsbG8=",
      "data:image/png,hello",
      "data:image/png;charset=utf-8;base64,aGVsbG8=",
      "data:text/plain;base64,aGVsbG8=",
      "https://example.com/screen.png",
      "",
    ]

    for (const url of urls) {
      expect([url, !!imageMime(url)]).toEqual([url, parseImage(url, "screen.png") !== null])
    }
  })

  it("returns the image mime type", () => {
    expect(imageMime("data:image/svg+xml;base64,aGVsbG8=")).toBe("image/svg+xml")
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
