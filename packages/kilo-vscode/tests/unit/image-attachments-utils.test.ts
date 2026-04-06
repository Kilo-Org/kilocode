import { describe, it, expect } from "bun:test"
import { isAcceptedImageType, isDragLeavingComponent } from "../../webview-ui/src/hooks/image-attachments-utils"

describe("isAcceptedImageType", () => {
  it("returns true for standard image types", () => {
    expect(isAcceptedImageType("image/png")).toBe(true)
    expect(isAcceptedImageType("image/jpeg")).toBe(true)
    expect(isAcceptedImageType("image/gif")).toBe(true)
    expect(isAcceptedImageType("image/webp")).toBe(true)
  })

  it("returns true for additional image formats", () => {
    expect(isAcceptedImageType("image/bmp")).toBe(true)
    expect(isAcceptedImageType("image/tiff")).toBe(true)
    expect(isAcceptedImageType("image/tif")).toBe(true)
    expect(isAcceptedImageType("image/heic")).toBe(true)
    expect(isAcceptedImageType("image/avif")).toBe(true)
    expect(isAcceptedImageType("image/x-icon")).toBe(true)
    expect(isAcceptedImageType("image/x-portable-pixmap")).toBe(true)
  })

  it("returns true for image/svg+xml specifically", () => {
    expect(isAcceptedImageType("image/svg+xml")).toBe(true)
    expect(isAcceptedImageType("image/svg+xml;charset=utf-8")).toBe(true)
  })

  it("returns false for other text types", () => {
    expect(isAcceptedImageType("text/plain")).toBe(false)
    expect(isAcceptedImageType("text/html")).toBe(false)
  })

  it("handles MIME type with parameters", () => {
    expect(isAcceptedImageType("image/png;base64")).toBe(true)
  })

  it("returns false for non-image types", () => {
    expect(isAcceptedImageType("application/pdf")).toBe(false)
    expect(isAcceptedImageType("video/mp4")).toBe(false)
    expect(isAcceptedImageType("audio/mp3")).toBe(false)
  })

  it("returns false for empty string", () => {
    expect(isAcceptedImageType("")).toBe(false)
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
