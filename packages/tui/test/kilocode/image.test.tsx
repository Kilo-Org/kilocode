import { expect, test } from "bun:test"
import type { TerminalCapabilities } from "@opentui/core"
import type { Part, ToolPart } from "@kilocode/sdk/v2"
import { testRender } from "@opentui/solid"
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  ImageAttachment,
  imageMode,
  imageProtocol,
  isImageMime,
  isRenderableImageUrl,
  toolImages,
} from "../../src/kilocode/image"

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJElEQVR4nGO4oxH1Hx+WI4AZRg0YHgacACrEg+UI4FEDhoUBALHOTh9Q7QLnAAAAAElFTkSuQmCC"

function caps(overrides: Partial<TerminalCapabilities> = {}): TerminalCapabilities {
  return {
    kitty_keyboard: false,
    kitty_graphics: false,
    rgb: true,
    ansi256: true,
    unicode: "unicode",
    sgr_pixels: false,
    color_scheme_updates: false,
    explicit_width: false,
    scaled_text: false,
    sixel: false,
    focus_tracking: false,
    sync: false,
    bracketed_paste: true,
    hyperlinks: true,
    osc52: false,
    osc52_support: "unsupported",
    notifications: false,
    explicit_cursor_positioning: false,
    remote: false,
    multiplexer: "none",
    terminal: { name: "test", version: "0", from_xtversion: false },
    ...overrides,
  }
}

function withProtocol<T>(value: string | undefined, run: () => Promise<T>) {
  const original = process.env.KILO_IMAGE_PROTOCOL
  if (value === undefined) delete process.env.KILO_IMAGE_PROTOCOL
  else process.env.KILO_IMAGE_PROTOCOL = value
  return run().finally(() => {
    if (original === undefined) delete process.env.KILO_IMAGE_PROTOCOL
    else process.env.KILO_IMAGE_PROTOCOL = original
  })
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

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
  await withProtocol("blocks", async () => {
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
  })
})

test("image attachment shows a placeholder when the terminal cannot draw images", async () => {
  await withProtocol(undefined, async () => {
    const app = await testRender(() => <ImageAttachment url={PNG} mime="image/png" filename="pixel.png" />, {
      width: 60,
      height: 20,
    })
    try {
      await app.flush()
      await settle()
      await app.flush()
      const frame = app.captureCharFrame()
      expect(frame).toContain("[Image: pixel.png 16x16]")
      expect(frame).not.toMatch(/[\u2580\u2584\u2588]/)
    } finally {
      app.renderer.destroy()
    }
  })
})

test("image attachment draws when the terminal reports kitty graphics", async () => {
  await withProtocol(undefined, async () => {
    const app = await testRender(() => <ImageAttachment url={PNG} mime="image/png" filename="pixel.png" />, {
      width: 60,
      height: 20,
    })
    try {
      app.renderer.emit("capabilities", caps({ kitty_graphics: true }))
      await app.flush()
      await settle()
      await app.flush()
      expect(app.captureCharFrame()).not.toContain("[Image:")
    } finally {
      app.renderer.destroy()
    }
  })
})

test("image attachment keeps the placeholder inside a multiplexer", async () => {
  await withProtocol(undefined, async () => {
    const app = await testRender(() => <ImageAttachment url={PNG} mime="image/png" filename="pixel.png" />, {
      width: 60,
      height: 20,
    })
    try {
      app.renderer.emit("capabilities", caps({ kitty_graphics: true, multiplexer: "tmux" }))
      await app.flush()
      await settle()
      await app.flush()
      expect(app.captureCharFrame()).toContain("[Image: pixel.png 16x16]")
    } finally {
      app.renderer.destroy()
    }
  })
})

test("image attachment falls back to a placeholder for undecodable data", async () => {
  await withProtocol(undefined, async () => {
    const app = await testRender(
      () => <ImageAttachment url="data:image/png;base64,bm90IGFuIGltYWdl" filename="broken.png" />,
      { width: 60, height: 10 },
    )
    try {
      await app.flush()
      await settle()
      await app.flush()
      expect(app.captureCharFrame()).toContain("[Image: broken.png]")
    } finally {
      app.renderer.destroy()
    }
  })
})

test("image mode resolves per terminal platform", () => {
  expect(imageMode(caps({ kitty_graphics: true }), false, "auto")).toBe("kitty")
  expect(imageMode(caps({ sixel: true }), true, "auto")).toBe("sixel")
  expect(imageMode(caps({ sixel: true }), false, "auto")).toBe(null)
  expect(imageMode(caps({ kitty_graphics: true, multiplexer: "tmux" }), false, "auto")).toBe(null)
  expect(imageMode(caps({ kitty_graphics: true, multiplexer: "screen" }), false, "auto")).toBe(null)
  expect(imageMode(caps({ kitty_graphics: true, multiplexer: "zellij" }), false, "auto")).toBe("kitty")
  expect(imageMode(null, false, "auto")).toBe(null)
  expect(imageMode(caps({ kitty_graphics: true }), false, "blocks")).toBe("blocks")
  expect(imageMode(caps(), false, "kitty")).toBe("kitty")
  expect(imageMode(caps({ kitty_graphics: true, multiplexer: "tmux" }), false, "sixel")).toBe("sixel")
})

test("image attachment reads a local file through a file url", async () => {
  await withProtocol("blocks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kilo-image-"))
    try {
      const file = join(dir, "local.png")
      writeFileSync(file, Buffer.from(PNG.slice(PNG.indexOf(",") + 1), "base64"))
      const app = await testRender(
        () => <ImageAttachment url={pathToFileURL(file).href} mime="image/png" filename="local.png" />,
        { width: 60, height: 40 },
      )
      try {
        const frame = await app.waitForFrame((value) => /[\u2580\u2584\u2588]/.test(value), { maxPasses: 400 })
        expect(frame).toContain("local.png")
      } finally {
        app.renderer.destroy()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test("image attachment rejects a directory or oversized file url", async () => {
  await withProtocol(undefined, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kilo-image-"))
    try {
      const big = join(dir, "big.png")
      writeFileSync(big, "")
      truncateSync(big, 21 * 1024 * 1024)

      const folder = await testRender(
        () => <ImageAttachment url={pathToFileURL(dir).href} mime="image/png" filename="folder.png" />,
        { width: 60, height: 10 },
      )
      try {
        await folder.flush()
        await settle()
        await folder.flush()
        expect(folder.captureCharFrame()).toContain("[Image: folder.png]")
      } finally {
        folder.renderer.destroy()
      }

      const large = await testRender(
        () => <ImageAttachment url={pathToFileURL(big).href} mime="image/png" filename="big.png" />,
        { width: 60, height: 10 },
      )
      try {
        await large.flush()
        await settle()
        await large.flush()
        expect(large.captureCharFrame()).toContain("[Image: big.png]")
      } finally {
        large.renderer.destroy()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test("image attachment falls back to a placeholder for a missing file", async () => {
  await withProtocol(undefined, async () => {
    const app = await testRender(
      () => <ImageAttachment url="file:///nonexistent/kilo-inline-image.png" mime="image/png" filename="gone.png" />,
      { width: 60, height: 10 },
    )
    try {
      await app.flush()
      await settle()
      await app.flush()
      expect(app.captureCharFrame()).toContain("[Image: gone.png]")
    } finally {
      app.renderer.destroy()
    }
  })
})
