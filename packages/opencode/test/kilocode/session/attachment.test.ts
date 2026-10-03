import { describe, expect, test } from "bun:test"
import { KiloAttachment } from "@/kilocode/session/attachment"

describe("KiloAttachment.classify", () => {
  test("classifies raster bitmap formats Photon can decode", () => {
    for (const mime of ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]) {
      expect(KiloAttachment.classify(mime)).toBe("raster")
    }
  })

  test("classifies SVG as markup, not raster", () => {
    expect(KiloAttachment.classify("image/svg+xml")).toBe("markup")
  })

  test("classifies icon container formats and the fastbidsheet mime as other", () => {
    for (const mime of ["image/x-icon", "image/vnd.microsoft.icon", "image/vnd.fastbidsheet"]) {
      expect(KiloAttachment.classify(mime)).toBe("other")
    }
  })

  test("classifies non-image mimes as other", () => {
    for (const mime of ["text/plain", "application/pdf", "application/x-directory", "application/octet-stream"]) {
      expect(KiloAttachment.classify(mime)).toBe("other")
    }
  })
})

describe("KiloAttachment.precheck", () => {
  // 1x1 white pixel
  const validPng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4AWMAAQAABQABDQottAAAAABJRU5ErkJggg=="

  test("accepts a well-formed raster data URL", () => {
    const reason = KiloAttachment.precheck({
      mime: "image/png",
      url: `data:image/png;base64,${validPng}`,
    })
    expect(reason).toBeUndefined()
  })

  test("rejects a raster data URL whose bytes are not a real image", () => {
    const reason = KiloAttachment.precheck({
      mime: "image/png",
      url: `data:image/png;base64,${Buffer.from("not an image").toString("base64")}`,
    })
    expect(reason).toBeDefined()
  })

  test("ignores SVG (markup, not raster)", () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`
    expect(KiloAttachment.precheck({ mime: "image/svg+xml", url: svg })).toBeUndefined()
  })

  test("rejects a raster data URL that is not base64 encoded", () => {
    // Image.normalize only accepts base64 data URLs (image.ts) and fails anything else with
    // InvalidDataUrlError, which the prompt pipeline turns into a defect.
    const reason = KiloAttachment.precheck({ mime: "image/png", url: "data:image/png,%89PNG%0D%0A" })
    expect(reason).toBeDefined()
  })

  test("ignores file:// urls (resolved later, with permission context)", () => {
    expect(KiloAttachment.precheck({ mime: "image/png", url: "file:///tmp/pixel.png" })).toBeUndefined()
  })

  test("ignores non-raster mimes", () => {
    expect(
      KiloAttachment.precheck({ mime: "application/octet-stream", url: "data:application/octet-stream;base64,AA==" }),
    ).toBeUndefined()
  })
})
