// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import {
  parseImageResponse,
  resolveProvider,
  ensureExtension,
  IMAGE_MODELS,
  DEFAULT_MODEL,
} from "../../../src/kilocode/tool/generate-image"

describe("generate-image response parser", () => {
  test("extracts PNG from data URL in choices[0].message.images[0]", () => {
    const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
    const body = JSON.stringify({
      choices: [
        {
          message: {
            images: [{ image_url: { url: `data:image/png;base64,${base64}` } }],
          },
        },
      ],
    })
    const result = parseImageResponse(body)
    expect(result).not.toBeNull()
    expect(result!.format).toBe("png")
    expect(result!.base64).toBe(base64)
  })

  test("extracts JPEG format", () => {
    const base64 = "/9j/4AAQSkZJRgABAQAAAQABAAD"
    const body = JSON.stringify({
      choices: [{ message: { images: [{ image_url: { url: `data:image/jpeg;base64,${base64}` } }] } }],
    })
    const result = parseImageResponse(body)
    expect(result!.format).toBe("jpeg")
    expect(result!.base64).toBe(base64)
  })

  test("returns null when choices array is empty", () => {
    expect(parseImageResponse(JSON.stringify({ choices: [] }))).toBeNull()
  })

  test("returns null when images array is missing", () => {
    const body = JSON.stringify({ choices: [{ message: {} }] })
    expect(parseImageResponse(body)).toBeNull()
  })

  test("returns null on malformed JSON", () => {
    expect(parseImageResponse("not json")).toBeNull()
  })

  test("returns null when data URL prefix is invalid", () => {
    const body = JSON.stringify({
      choices: [{ message: { images: [{ image_url: { url: "https://example.com/image.png" } }] } }],
    })
    expect(parseImageResponse(body)).toBeNull()
  })
})

describe("generate-image provider resolver", () => {
  test("uses Kilo cloud when Kilo auth is present", () => {
    const result = resolveProvider({ type: "oauth", access: "kilo-token", accountId: "org-123" }, undefined)
    expect(result).not.toBeNull()
    expect(result!.token).toBe("kilo-token")
    expect(result!.organizationId).toBe("org-123")
    expect(result!.provider).toBe("kilo")
    expect(result!.url).toContain("openrouter")
  })

  test("uses Kilo cloud with API key auth", () => {
    const result = resolveProvider({ type: "api", key: "kilo-api-key" }, undefined)
    expect(result!.token).toBe("kilo-api-key")
    expect(result!.provider).toBe("kilo")
  })

  test("falls back to OpenRouter with BYO key when no Kilo auth", () => {
    const result = resolveProvider(undefined, "or-key-123")
    expect(result!.provider).toBe("openrouter")
    expect(result!.token).toBe("or-key-123")
    expect(result!.url).toContain("openrouter.ai")
  })

  test("returns null when no auth source is available", () => {
    expect(resolveProvider(undefined, undefined)).toBeNull()
  })

  test("prefers Kilo auth over OpenRouter key", () => {
    const result = resolveProvider({ type: "oauth", access: "kilo-token" }, "or-key")
    expect(result!.provider).toBe("kilo")
    expect(result!.token).toBe("kilo-token")
  })
})

describe("generate-image response parser MIME normalization", () => {
  test("normalizes jpg data URL to jpeg format", () => {
    const base64 = "/9j/4AAQSkZJRgABAQAAAQABAAD"
    const body = JSON.stringify({
      choices: [{ message: { images: [{ image_url: { url: `data:image/jpg;base64,${base64}` } }] } }],
    })
    const result = parseImageResponse(body)
    expect(result!.format).toBe("jpeg")
    expect(result!.base64).toBe(base64)
  })
})

describe("generate-image path extension", () => {
  test("appends .png when no extension", () => {
    expect(ensureExtension("output/logo", "png")).toBe("output/logo.png")
  })

  test("appends .jpg for jpeg format", () => {
    expect(ensureExtension("output/photo", "jpeg")).toBe("output/photo.jpg")
  })

  test("keeps existing .png extension when format is png", () => {
    expect(ensureExtension("output/logo.png", "png")).toBe("output/logo.png")
  })

  test("keeps existing .jpg extension when format is jpeg", () => {
    expect(ensureExtension("output/photo.jpg", "jpeg")).toBe("output/photo.jpg")
  })

  test("keeps existing .jpeg extension when format is jpeg", () => {
    expect(ensureExtension("output/photo.jpeg", "jpeg")).toBe("output/photo.jpeg")
  })

  test("replaces mismatched image extension when format differs", () => {
    expect(ensureExtension("output/photo.jpg", "png")).toBe("output/photo.png")
    expect(ensureExtension("output/photo.jpeg", "png")).toBe("output/photo.png")
    expect(ensureExtension("output/logo.png", "jpeg")).toBe("output/logo.jpg")
  })

  test("keeps uppercase .PNG extension when format is png", () => {
    expect(ensureExtension("output/logo.PNG", "png")).toBe("output/logo.PNG")
  })

  test("appends when path has a dot that is not an image extension", () => {
    expect(ensureExtension("assets/logo.final", "png")).toBe("assets/logo.final.png")
  })
})

describe("generate-image model catalog", () => {
  test("has a non-empty model list", () => {
    expect(IMAGE_MODELS.length).toBeGreaterThan(0)
  })

  test("includes the default model", () => {
    expect(IMAGE_MODELS.some((m) => m.value === DEFAULT_MODEL)).toBe(true)
  })

  test("every model has value and label", () => {
    for (const m of IMAGE_MODELS) {
      expect(typeof m.value).toBe("string")
      expect(m.value.length).toBeGreaterThan(0)
      expect(typeof m.label).toBe("string")
      expect(m.label.length).toBeGreaterThan(0)
    }
  })
})
