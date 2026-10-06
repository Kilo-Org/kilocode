import { describe, it, expect } from "bun:test"
import {
  ACCEPTED_IMAGE_TYPES,
  isAcceptedImageType,
  isDataAttachment,
  isDragLeavingComponent,
  textDataUrl,
} from "../../webview-ui/src/hooks/image-attachments-utils"

describe("ACCEPTED_IMAGE_TYPES", () => {
  it("includes the standard image MIME types", () => {
    expect(ACCEPTED_IMAGE_TYPES).toContain("image/png")
    expect(ACCEPTED_IMAGE_TYPES).toContain("image/jpeg")
    expect(ACCEPTED_IMAGE_TYPES).toContain("image/gif")
    expect(ACCEPTED_IMAGE_TYPES).toContain("image/webp")
  })
})

describe("isAcceptedImageType", () => {
  it("returns true for accepted types", () => {
    expect(isAcceptedImageType("image/png")).toBe(true)
    expect(isAcceptedImageType("image/jpeg")).toBe(true)
    expect(isAcceptedImageType("image/gif")).toBe(true)
    expect(isAcceptedImageType("image/webp")).toBe(true)
  })

  it("returns false for non-image types", () => {
    expect(isAcceptedImageType("application/pdf")).toBe(false)
    expect(isAcceptedImageType("text/plain")).toBe(false)
    expect(isAcceptedImageType("video/mp4")).toBe(false)
  })

  it("returns false for empty string", () => {
    expect(isAcceptedImageType("")).toBe(false)
  })

  it("returns false for image types not in the accepted list", () => {
    expect(isAcceptedImageType("image/svg+xml")).toBe(false)
    expect(isAcceptedImageType("image/bmp")).toBe(false)
  })
})

describe("isDragLeavingComponent", () => {
  it("returns true when relatedTarget is null (left the page)", () => {
    const el = { contains: () => false } as unknown as HTMLElement
    expect(isDragLeavingComponent(null, el)).toBe(true)
  })

  it("returns false when relatedTarget is a child (contains returns true)", () => {
    const child = {} as EventTarget
    const parent = { contains: (n: Node) => n === child } as unknown as HTMLElement
    expect(isDragLeavingComponent(child, parent)).toBe(false)
  })

  it("returns true when relatedTarget is outside (contains returns false)", () => {
    const outside = {} as EventTarget
    const container = { contains: () => false } as unknown as HTMLElement
    expect(isDragLeavingComponent(outside, container)).toBe(true)
  })
})

describe("textDataUrl", () => {
  it("encodes UTF-8 text as a text/plain data URL", () => {
    const text = "# Notes\nunicode: é ✓ 日本\n"
    const url = textDataUrl(new TextEncoder().encode(text))
    expect(url?.startsWith("data:text/plain;base64,")).toBe(true)
    expect(Buffer.from(url!.slice("data:text/plain;base64,".length), "base64").toString("utf8")).toBe(text)
  })

  it("encodes an empty file", () => {
    expect(textDataUrl(new Uint8Array())).toBe("data:text/plain;base64,")
  })

  it("rejects data with NUL bytes", () => {
    expect(textDataUrl(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]))).toBeUndefined()
  })

  it("rejects invalid UTF-8", () => {
    expect(textDataUrl(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]))).toBeUndefined()
  })
})

describe("isDataAttachment", () => {
  it("accepts image and text data URLs", () => {
    expect(isDataAttachment({ mime: "image/png", url: "data:image/png;base64,abc" })).toBe(true)
    expect(isDataAttachment({ mime: "text/plain", url: "data:text/plain;base64,abc" })).toBe(true)
  })

  it("rejects other mime types and non-data URLs", () => {
    expect(isDataAttachment({ mime: "application/pdf", url: "data:application/pdf;base64,abc" })).toBe(false)
    expect(isDataAttachment({ mime: "text/plain", url: "file:///repo/a.ts" })).toBe(false)
    expect(isDataAttachment({ mime: "image/png", url: "https://example.com/a.png" })).toBe(false)
  })
})
