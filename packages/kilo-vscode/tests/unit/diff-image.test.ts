import { describe, expect, it } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { imageMime, loadImage, MAX_IMAGE_BYTES, readImageFile } from "../../src/diff/shared/image"
import { parseRawOids } from "../../src/diff/sources/git-status"

describe("diff images", () => {
  it("recognizes every image format handled by the VS Code image preview", () => {
    const files = [
      "photo.jpg",
      "photo.jpe",
      "photo.jpeg",
      "image.png",
      "image.bmp",
      "animation.gif",
      "favicon.ico",
      "image.webp",
      "image.avif",
      "vector.svg",
    ]

    for (const file of files) expect(imageMime(file)).toStartWith("image/")
    expect(imageMime("ASSETS/LOGO.PNG")).toBe("image/png")
    expect(imageMime("archive.zip")).toBeUndefined()
    expect(imageMime("photo.tiff")).toBeUndefined()
  })

  it("parses image blob identities from a single raw diff", () => {
    const before = "1".repeat(40)
    const after = "2".repeat(40)
    const refs = parseRawOids(`:100644 100644 ${before} ${after} M\tassets/banner.png\n`)

    expect(refs.get("assets/banner.png")).toEqual({ before, after })
  })

  it("encodes image sides without converting bytes to text", async () => {
    const before = Buffer.from([0x00, 0xff, 0x10, 0x80])
    const after = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const image = await loadImage(
      "asset.png",
      { bytes: before.byteLength, read: async () => before },
      { bytes: after.byteLength, read: async () => after },
    )

    expect(image?.before).toEqual({ mime: "image/png", bytes: 4, data: before.toString("base64") })
    expect(image?.after).toEqual({ mime: "image/png", bytes: 4, data: after.toString("base64") })
  })

  it("bounds mutable image reads to the payload cap", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diff-image-test-"))
    const file = path.join(dir, "large.png")
    try {
      await fs.writeFile(file, Buffer.alloc(MAX_IMAGE_BYTES + 100))
      expect((await readImageFile(file))?.byteLength).toBe(MAX_IMAGE_BYTES + 1)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it("does not read image sides over the webview payload cap", async () => {
    let reads = 0
    const image = await loadImage("asset.webp", {
      bytes: MAX_IMAGE_BYTES + 1,
      read: async () => {
        reads++
        return Buffer.from("unused")
      },
    })

    expect(reads).toBe(0)
    expect(image?.before).toEqual({
      mime: "image/webp",
      bytes: MAX_IMAGE_BYTES + 1,
      error: "too-large",
    })
  })
})
