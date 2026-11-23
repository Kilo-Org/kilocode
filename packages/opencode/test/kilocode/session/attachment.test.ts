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

  // 1x1 JPEG
  const validJpeg =
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDc0NP/bAEMBCQkJDAsMGA0NGDIhHCEyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q=="

  test("accepts a raster image whose declared mime is wrong but whose bytes decode", () => {
    // Photon decodes by content, so JPEG bytes labelled image/png worked before this precheck
    // existed and must keep working -- the sniffed format is what matters.
    const reason = KiloAttachment.precheck({ mime: "image/png", url: `data:image/png;base64,${validJpeg}` })
    expect(reason).toBeUndefined()
  })

  test("accepts base64 that is line-wrapped", () => {
    // Buffer.from tolerates embedded newlines, so a wrapped payload still decodes and must not
    // be rejected for failing a canonical round-trip comparison.
    const wrapped = (validPng.match(/.{1,32}/g) ?? []).join("\n")
    expect(wrapped).toContain("\n")
    const reason = KiloAttachment.precheck({ mime: "image/png", url: `data:image/png;base64,${wrapped}` })
    expect(reason).toBeUndefined()
  })

  test("rejects BMP bytes, which the raster decoder traps on", () => {
    const bmp = Buffer.concat([Buffer.from([0x42, 0x4d]), Buffer.alloc(64, 1)]).toString("base64")
    expect(KiloAttachment.precheck({ mime: "image/png", url: `data:image/png;base64,${bmp}` })).toBeDefined()
  })

  test("rejects a malformed non-base64 data URL for any mime", () => {
    // decodeDataUrl runs a non-base64 body through decodeURIComponent, which throws URIError on
    // a bad escape. That throw would become a defect and lose the message, so reject it here --
    // including for markup, which reaches the same decode even though it is not a raster.
    expect(KiloAttachment.precheck({ mime: "image/svg+xml", url: "data:image/svg+xml,%E0%A4%A" })).toBeDefined()
    expect(KiloAttachment.precheck({ mime: "text/plain", url: "data:text/plain,%E0%A4%A" })).toBeDefined()
  })

  test("accepts a well-formed non-base64 markup data URL", () => {
    const url = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg'/>")}`
    expect(KiloAttachment.precheck({ mime: "image/svg+xml", url })).toBeUndefined()
  })
})

describe("KiloAttachment.asText", () => {
  test("relabels a markup file part as text/plain", () => {
    const part = { type: "file", mime: "image/svg+xml", url: "data:image/svg+xml;base64,PHN2Zy8+" }
    expect(KiloAttachment.asText(part).mime).toBe("text/plain")
  })

  test("leaves raster, other, and non-file parts untouched", () => {
    const png = { type: "file", mime: "image/png", url: "data:image/png;base64,AA==" }
    expect(KiloAttachment.asText(png)).toBe(png)
    const pdf = { type: "file", mime: "application/pdf", url: "file:///tmp/a.pdf" }
    expect(KiloAttachment.asText(pdf)).toBe(pdf)
    const text = { type: "text", text: "image/svg+xml" }
    expect(KiloAttachment.asText(text)).toBe(text)
  })
})
