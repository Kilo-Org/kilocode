import { describe, it, expect } from "bun:test"
import {
  ACCEPTED_IMAGE_TYPES,
  getBase64ByteLength,
  getImageDimensions,
  isAcceptedImageType,
  isDragLeavingComponent,
  isStaticImageType,
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

describe("isStaticImageType", () => {
  it("returns true for canvas-safe static formats", () => {
    expect(isStaticImageType("image/png")).toBe(true)
    expect(isStaticImageType("image/jpeg")).toBe(true)
    expect(isStaticImageType("image/webp")).toBe(true)
  })

  it("returns false for animated GIFs", () => {
    expect(isStaticImageType("image/gif")).toBe(false)
  })
})

describe("getImageDimensions", () => {
  it("preserves aspect ratio while limiting the longest side", () => {
    expect(getImageDimensions(3840, 2160)).toEqual({ width: 1600, height: 900 })
    expect(getImageDimensions(1000, 2000)).toEqual({ width: 800, height: 1600 })
  })

  it("does not enlarge images already within the limit", () => {
    expect(getImageDimensions(800, 600)).toEqual({ width: 800, height: 600 })
  })
})

describe("getBase64ByteLength", () => {
  it("returns the encoded payload length", () => {
    expect(getBase64ByteLength(0)).toBe(0)
    expect(getBase64ByteLength(1)).toBe(4)
    expect(getBase64ByteLength(3)).toBe(4)
    expect(getBase64ByteLength(4)).toBe(8)
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
