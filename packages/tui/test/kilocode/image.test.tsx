import { expect, test } from "bun:test"
import type { Part, ToolPart } from "@kilocode/sdk/v2"
import { testRender } from "@opentui/solid"
import { ImageAttachment, imageProtocol, isImageMime, isRenderableImageUrl } from "../../src/kilocode/image"
import { toolImages } from "../../src/routes/session"

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJElEQVR4nGO4oxH1Hx+WI4AZRg0YHgacACrEg+UI4FEDhoUBALHOTh9Q7QLnAAAAAElFTkSuQmCC"

test("image mime detection excludes svg text attachments", () => {
  expect(isImageMime("image/png")).toBe(true)
  expect(isImageMime("image/jpeg")).toBe(true)
  expect(isImageMime("image/webp")).toBe(true)
  expect(isImageMime("image/svg+xml")).toBe(false)
  expect(isImageMime("application/pdf")).toBe(false)
  expect(isImageMime(undefined)).toBe(false)
})

test("renderable image urls cover base64 data and file sources only", () => {
  expect(isRenderableImageUrl("data:image/png;base64,AAAA")).toBe(true)
  expect(isRenderableImageUrl("file:///tmp/a.png")).toBe(true)
  expect(isRenderableImageUrl("data:image/png,notbase64")).toBe(false)
  expect(isRenderableImageUrl("https://example.com/a.png")).toBe(false)
  expect(isRenderableImageUrl(undefined)).toBe(false)
})

test("image protocol override honors recognized values and defaults to auto", () => {
  const original = process.env.KILO_IMAGE_PROTOCOL
  try {
    delete process.env.KILO_IMAGE_PROTOCOL
    expect(imageProtocol()).toBe("auto")
    process.env.KILO_IMAGE_PROTOCOL = "kitty"
    expect(imageProtocol()).toBe("kitty")
    process.env.KILO_IMAGE_PROTOCOL = "sixel"
    expect(imageProtocol()).toBe("sixel")
    process.env.KILO_IMAGE_PROTOCOL = "blocks"
    expect(imageProtocol()).toBe("blocks")
    process.env.KILO_IMAGE_PROTOCOL = "bogus"
    expect(imageProtocol()).toBe("auto")
  } finally {
    if (original === undefined) delete process.env.KILO_IMAGE_PROTOCOL
    else process.env.KILO_IMAGE_PROTOCOL = original
  }
})

function toolPart(state: ToolPart["state"]): Part {
  return {
    id: "prt_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool: "read",
    state,
  }
}

test("tool images select only completed image attachments with renderable urls", () => {
  const completed = toolPart({
    status: "completed",
    input: {},
    output: "ok",
    title: "read",
    metadata: {},
    time: { start: 1, end: 2 },
    attachments: [
      { id: "f1", sessionID: "ses_1", messageID: "msg_1", type: "file", mime: "image/png", url: "data:image/png;base64,AAAA" },
      { id: "f2", sessionID: "ses_1", messageID: "msg_1", type: "file", mime: "image/png", url: "file:///tmp/a.png" },
      { id: "f3", sessionID: "ses_1", messageID: "msg_1", type: "file", mime: "image/png", url: "https://example.com/a.png" },
      { id: "f4", sessionID: "ses_1", messageID: "msg_1", type: "file", mime: "text/plain", url: "data:text/plain;base64,AAAA" },
      { id: "f5", sessionID: "ses_1", messageID: "msg_1", type: "file", mime: "image/svg+xml", url: "data:image/svg+xml;base64,AAAA" },
    ],
  })
  expect(toolImages(completed).map((x) => x.id)).toEqual(["f1", "f2"])
  expect(toolImages(toolPart({ status: "running", input: {}, time: { start: 1 } }))).toEqual([])
  const text: Part = {
    id: "prt_2",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "text",
    text: "hi",
    time: { start: 1, end: 2 },
  }
  expect(toolImages(text)).toEqual([])
})

test("image attachment renders pixels when a protocol is forced", async () => {
  const original = process.env.KILO_IMAGE_PROTOCOL
  process.env.KILO_IMAGE_PROTOCOL = "blocks"
  try {
    const app = await testRender(() => <ImageAttachment url={PNG} mime="image/png" filename="pixel.png" />, {
      width: 60,
      height: 40,
    })
    try {
      const frame = await app.waitForFrame((value) => /[\u2580\u2584\u2588]/.test(value), { maxPasses: 400 })
      expect(frame).toMatch(/[\u2580\u2584\u2588]/)
      expect(frame).toContain("pixel.png")
    } finally {
      app.renderer.destroy()
    }
  } finally {
    if (original === undefined) delete process.env.KILO_IMAGE_PROTOCOL
    else process.env.KILO_IMAGE_PROTOCOL = original
  }
})

test("image attachment shows a placeholder when the terminal cannot draw images", async () => {
  const original = process.env.KILO_IMAGE_PROTOCOL
  delete process.env.KILO_IMAGE_PROTOCOL
  try {
    const app = await testRender(() => <ImageAttachment url={PNG} mime="image/png" filename="pixel.png" />, {
      width: 60,
      height: 20,
    })
    try {
      await app.flush()
      await new Promise((resolve) => setTimeout(resolve, 50))
      await app.flush()
      const frame = app.captureCharFrame()
      expect(frame).toContain("[Image: pixel.png 16x16]")
      expect(frame).not.toMatch(/[\u2580\u2584\u2588]/)
    } finally {
      app.renderer.destroy()
    }
  } finally {
    if (original === undefined) delete process.env.KILO_IMAGE_PROTOCOL
    else process.env.KILO_IMAGE_PROTOCOL = original
  }
})

test("image attachment ignores data that is not a decodable image", async () => {
  const app = await testRender(
    () => <ImageAttachment url="data:image/png;base64,bm90IGFuIGltYWdl" filename="broken.png" />,
    { width: 60, height: 10 },
  )
  try {
    await app.flush()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await app.flush()
    expect(app.captureCharFrame()).not.toContain("broken.png")
  } finally {
    app.renderer.destroy()
  }
})
