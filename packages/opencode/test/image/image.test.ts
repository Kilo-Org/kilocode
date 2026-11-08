import { describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Effect, Exit } from "effect"
import { Image } from "@/image/image"
import { KiloAttachment } from "@/kilocode/session/attachment" // kilocode_change - pin boundary/fallback agreement
import { Config } from "@/config/config"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Image.node, [[Config.node, TestConfig.layer()]]))
const tiny = testEffect(
  LayerNode.compile(Image.node, [
    [Config.node, TestConfig.layer({ get: () => Effect.succeed({ attachment: { image: { max_base64_bytes: 1 } } }) })],
  ]),
)

function part(mime: string, data: string) {
  return {
    id: PartID.ascending(),
    messageID: MessageID.ascending(),
    sessionID: SessionID.make("ses_test"),
    type: "file" as const,
    mime,
    url: `data:${mime};base64,${data}`,
  }
}

describe("Image", () => {
  it.effect("normalizes generated png and jpeg attachments", () =>
    Effect.gen(function* () {
      const photon = yield* Effect.promise(() => import("@silvia-odwyer/photon-node"))
      const source = new photon.PhotonImage(
        new Uint8Array(Array.from({ length: 64 * 64 * 4 }, (_, index) => (index % 4 === 3 ? 255 : index % 251))),
        64,
        64,
      )
      const image = yield* Image.Service
      const results = yield* Effect.all([
        image.normalize(part("image/png", Buffer.from(source.get_bytes()).toString("base64"))),
        image.normalize(part("image/jpeg", Buffer.from(source.get_bytes_jpeg(90)).toString("base64"))),
      ])

      source.free()
      expect(results.map((result) => result.url.startsWith(`data:${result.mime};base64,`))).toEqual([true, true])
      expect(results.every((result) => result.mime === "image/png" || result.mime === "image/jpeg")).toBe(true)
    }),
  )

  it.effect("accepts webp attachments that are already within limits", () =>
    Effect.gen(function* () {
      const image = yield* Image.Service
      const input = part("image/webp", "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA")

      expect(yield* image.normalize(input)).toEqual(input)
    }),
  )

  // kilocode_change start - cover Kilo's Photon-unavailable fallback
  test("preserves a valid in-limit image without Photon", () => {
    const data = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA"
    const input = part("image/webp", data)

    expect(Image.fallback(input, data, { bytes: 1024, width: 2000, height: 2000 })).toEqual(input)
  })

  test("rejects non-image bytes without Photon", () => {
    const data = Buffer.from("not an image").toString("base64")
    const result = Image.fallback(part("image/png", data), data, { bytes: 1024, width: 2000, height: 2000 })

    expect(result).toBeInstanceOf(Image.DecodeError)
  })

  test("rejects oversized encoded input before decoding without Photon", () => {
    const data = "A".repeat(8 * 1024 * 1024)
    const result = Image.fallback(part("image/png", data), data, { bytes: 1024, width: 2000, height: 2000 })

    expect(result).toBeInstanceOf(Image.SizeError)
    if (result instanceof Image.SizeError) expect(result.bytes).toBe(data.length)
  })

  // The HTTP-boundary precheck (kilocode/session/attachment.ts) waves an attachment through
  // based on content. If this fallback disagreed, an attachment accepted at the boundary would
  // later die as a defect inside resolvePart -- and on prompt_async that surfaces only after the
  // route already returned 204, losing the typed message. These two pin the agreement.
  test("accepts a line-wrapped payload without Photon, matching the boundary precheck", () => {
    const flat = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA"
    const wrapped = (flat.match(/.{1,16}/g) ?? []).join("\n")
    expect(wrapped).toContain("\n")
    const input = part("image/webp", wrapped)

    expect(KiloAttachment.precheck({ mime: "image/webp", url: input.url })).toBeUndefined()
    expect(Image.fallback(input, wrapped, { bytes: 1024, width: 2000, height: 2000 })).toEqual(input)
  })

  test("accepts a mislabelled but decodable image without Photon, matching the boundary precheck", () => {
    // WebP bytes declared as image/png: Photon sniffs the real format, so both the boundary and
    // this fallback must judge by content rather than by the declared mime.
    const data = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA"
    const input = part("image/png", data)

    expect(KiloAttachment.precheck({ mime: "image/png", url: input.url })).toBeUndefined()
    expect(Image.fallback(input, data, { bytes: 1024, width: 2000, height: 2000 })).toEqual(input)
  })

  test("rejects BMP bytes at both the boundary and the fallback", () => {
    const bmp = Buffer.concat([Buffer.from([0x42, 0x4d]), Buffer.alloc(64, 1)]).toString("base64")
    const input = part("image/png", bmp)

    expect(KiloAttachment.precheck({ mime: "image/png", url: input.url })).toBeDefined()
    expect(Image.fallback(input, bmp, { bytes: 1024, width: 2000, height: 2000 })).toBeInstanceOf(Image.DecodeError)
  })

  test("rejects an image with oversized header dimensions without Photon", () => {
    const png = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png)
    png.write("IHDR", 12, "ascii")
    png.writeUInt32BE(10_000, 16)
    png.writeUInt32BE(1, 20)
    const data = png.toString("base64")
    const result = Image.fallback(part("image/png", data), data, { bytes: 1024, width: 2000, height: 2000 })

    expect(result).toBeInstanceOf(Image.SizeError)
    if (result instanceof Image.SizeError) {
      expect(result.width).toBe(10_000)
      expect(result.height).toBe(1)
    }
  })
  // kilocode_change end

  tiny.effect("fails with a typed size error when no resized candidate fits", () =>
    Effect.gen(function* () {
      const photon = yield* Effect.promise(() => import("@silvia-odwyer/photon-node"))
      const source = new photon.PhotonImage(new Uint8Array(Array.from({ length: 4 }, () => 255)), 1, 1)
      const image = yield* Image.Service
      const exit = yield* image
        .normalize(part("image/png", Buffer.from(source.get_bytes()).toString("base64")))
        .pipe(Effect.exit)

      source.free()
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(Image.SizeError)
        if (error instanceof Image.SizeError) {
          expect(error.width).toBe(1)
          expect(error.height).toBe(1)
          expect(error.max).toBe(1)
        }
      }
    }),
  )
})
