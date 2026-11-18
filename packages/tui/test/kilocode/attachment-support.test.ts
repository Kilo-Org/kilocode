// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { unsupportedAttachments, type Capabilities, type Modality } from "../../src/kilocode/attachment-support"

const all: Capabilities = { image: true, audio: true, video: true, pdf: true }
const none: Capabilities = { image: false, audio: false, video: false, pdf: false }

describe("unsupportedAttachments", () => {
  test.each<{ name: string; mime: string; caps: Capabilities | undefined; expected: Modality[] }>([
    { name: "image on image-capable model", mime: "image/png", caps: all, expected: [] },
    {
      name: "image on model without image input",
      mime: "image/png",
      caps: { ...all, image: false },
      expected: ["image"],
    },
    { name: "pdf unsupported", mime: "application/pdf", caps: { ...all, pdf: false }, expected: ["pdf"] },
    { name: "audio unsupported", mime: "audio/mpeg", caps: { ...all, audio: false }, expected: ["audio"] },
    { name: "video unsupported", mime: "video/mp4", caps: { ...all, video: false }, expected: ["video"] },
    { name: "svg as text is not an attachment", mime: "text/plain", caps: none, expected: [] },
    { name: "unknown mime ignored", mime: "application/zip", caps: none, expected: [] },
    { name: "unknown model allowed", mime: "image/png", caps: undefined, expected: [] },
  ])("$name", ({ mime, caps, expected }) => {
    const result = unsupportedAttachments([{ type: "file", mime, filename: "a" }], caps)
    expect(result.map((item) => item.modality)).toEqual(expected)
  })

  test("text parts are ignored and filename is reported", () => {
    const result = unsupportedAttachments(
      [{ type: "text" }, { type: "file", mime: "image/png", filename: "shot.png" }],
      none,
    )
    expect(result).toEqual([{ filename: "shot.png", modality: "image" }])
  })
})
