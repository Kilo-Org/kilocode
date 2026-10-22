import { describe, it, expect } from "bun:test"
import {
  ACCEPTED_IMAGE_TYPES,
  isAcceptedImageType,
  isDragLeavingComponent,
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
