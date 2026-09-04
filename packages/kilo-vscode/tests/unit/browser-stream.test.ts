import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { existsSync } from "node:fs"
import { chromium, type Browser, type Page } from "playwright-core"
import { BrowserStream } from "../../src/services/browser-automation/browser-stream"
import { source, type BrowserFrame, type BrowserInteraction } from "../../src/shared/browser-stream"

const streams: BrowserStream[] = []
const pages: Page[] = []
const view = { width: 640, height: 480, revision: 1, active: true }
const executable = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  chromium.executablePath(),
].find((path) => path && existsSync(path))

function jpeg(width = view.width, height = view.height, length = 17) {
  const data = Buffer.alloc(length)
  data.set([255, 216, 255, 192, 0, 11, 8, 0, 0, 0, 0, 1, 1, 17, 0, 255, 217])
  data.writeUInt16BE(height, 7)
  data.writeUInt16BE(width, 9)
  return data
}

function protocol() {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = []
  const hooks = new Map<string, () => Promise<void>>()
  const frames: BrowserFrame[] = []
  const logs: unknown[][] = []
  const scope = { browserId: "browser", navigation: 1 }
  const delivery = { fail: false }
  const session = Object.assign(new EventEmitter(), {
    send: async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params })
      await hooks.get(method)?.()
      return {}
    },
    detach: async () => {
      calls.push({ method: "detach" })
      await hooks.get("detach")?.()
    },
  })
  const page = Object.assign(new EventEmitter(), {
    context: () => ({
      newCDPSession: async () => {
        calls.push({ method: "connect" })
        await hooks.get("connect")?.()
        return session
      },
    }),
    setViewportSize: async (size: { width: number; height: number }) => {
      calls.push({ method: "resize", params: size })
      await hooks.get("resize")?.()
    },
    mainFrame: () => page,
    evaluate: async (_fn: unknown, opts: { action: string; text?: string }) => ({
      focused: true,
      text: opts.action === "paste" ? opts.text : "copied",
    }),
  })
  const stream = new BrowserStream(
    page as unknown as Page,
    () => scope,
    (frame) => {
      if (delivery.fail) throw new Error(frame.data)
      frames.push(frame)
    },
    (...args) => logs.push(args),
  )
  streams.push(stream)
  const send = (id: number, data?: string, size = view) => {
    session.emit("Page.screencastFrame", {
      sessionId: id,
      data: data ?? jpeg(size.width, size.height).toString("base64"),
      metadata: { deviceWidth: size.width, deviceHeight: size.height },
    })
  }
  return { stream, session, page, calls, hooks, frames, logs, scope, send, delivery }
}

afterEach(async () => {
  await Promise.all(streams.splice(0).map((stream) => stream.close()))
  await Promise.all(pages.splice(0).map((page) => page.close()))
})

describe("BrowserStream protocol lifecycle", () => {
  test("keeps frame sources in data images without treating payloads as external URLs", () => {
    const payload = jpeg().toString("base64")
    expect(source(payload)).toBe(`data:image/jpeg;base64,${payload}`)
    for (const type of ["jpeg", "png", "webp"]) {
      const image = `data:image/${type};base64,${payload}`
      expect(source(image)).toBe(image)
    }
    for (const value of ["https://public.example/image", "javascript:alert(1)"]) {
      expect(source(value)).toBe(`data:image/jpeg;base64,${value}`)
    }
    expect(source(`data:image/svg+xml;base64,${payload}`)).toBeUndefined()
    expect(source(`data:text/html;base64,${payload}`)).toBeUndefined()
  })

  test("acknowledges CDP immediately and keeps only the newest buffered frame while input is blocked", async () => {
    const fixture = protocol()
    await fixture.stream.configure(view)
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    fixture.hooks.set("Input.insertText", async () => {
      entered.resolve()
      await resume.promise
    })
    const input = fixture.stream.interact({ kind: "text", text: "typing" })
    await entered.promise
    try {
      fixture.send(1)
      fixture.send(2)
      fixture.send(3)
      expect(fixture.frames.map((frame) => frame.sequence)).toEqual([1])
      expect(
        fixture.calls.filter((call) => call.method === "Page.screencastFrameAck").map((call) => call.params?.sessionId),
      ).toEqual([1, 2, 3])
      fixture.stream.acknowledge(999)
      fixture.stream.acknowledge(NaN)
      expect(fixture.frames).toHaveLength(1)
      fixture.stream.acknowledge(1)
      expect(fixture.frames.map((frame) => frame.sequence)).toEqual([1, 3])
      fixture.send(4)
      fixture.stream.acknowledge(1)
      expect(fixture.frames).toHaveLength(2)
      fixture.stream.acknowledge(3)
      expect(fixture.frames.map((frame) => frame.sequence)).toEqual([1, 3, 4])
    } finally {
      resume.resolve()
      await input
    }
  })

  test("keeps paste ahead of later input while reading the clipboard", async () => {
    const fixture = protocol()
    await fixture.stream.configure(view)
    const entered = Promise.withResolvers<void>()
    const clipboard = Promise.withResolvers<string>()
    const paste = fixture.stream.interact({ kind: "clipboard", action: "paste" }, () => {
      entered.resolve()
      return clipboard.promise
    })
    await entered.promise
    const next = fixture.stream.interact({ kind: "text", text: "after" })
    clipboard.resolve("pasted")
    await Promise.all([paste, next])
    expect(fixture.calls.filter((call) => call.method === "Input.insertText").map((call) => call.params?.text)).toEqual(
      ["pasted", "after"],
    )
  })

  test.each(["resize", "close"])("cancels a pending clipboard read on %s", async (action) => {
    const fixture = protocol()
    await fixture.stream.configure(view)
    const entered = Promise.withResolvers<void>()
    const clipboard = Promise.withResolvers<string>()
    const paste = fixture.stream.interact({ kind: "clipboard", action: "paste" }, () => {
      entered.resolve()
      return clipboard.promise
    })
    await entered.promise
    await (action === "close" ? fixture.stream.close() : fixture.stream.configure({ ...view, revision: 2 }))
    await paste
    clipboard.resolve("stale")
    expect(fixture.calls.filter((call) => call.method === "Input.insertText")).toEqual([])
  })

  test.each(["resize", "close"])("does not block %s on a pending clipboard write", async (action) => {
    const fixture = protocol()
    await fixture.stream.configure(view)
    const entered = Promise.withResolvers<void>()
    const written = Promise.withResolvers<void>()
    const copying = fixture.stream.interact({ kind: "clipboard", action: "copy" }, undefined, () => {
      entered.resolve()
      return written.promise
    })
    await entered.promise
    const changed = action === "close" ? fixture.stream.close() : fixture.stream.configure({ ...view, revision: 2 })
    try {
      await Promise.race([
        changed,
        Bun.sleep(1000).then(() => {
          throw new Error("Clipboard write prevented stream cleanup")
        }),
      ])
      expect(await copying).toBeUndefined()
    } finally {
      written.resolve()
      await Promise.allSettled([copying, changed])
    }
  })

  test("validates clipboard results before calling the host writer", async () => {
    const fixture = protocol()
    await fixture.stream.configure(view)
    const values: string[] = []
    for (const value of ["x".repeat(65537), 42]) {
      fixture.page.evaluate = async () => ({ focused: true, text: value as unknown as string })
      await expect(
        fixture.stream.interact({ kind: "clipboard", action: "copy" }, undefined, (text) => {
          values.push(text)
        }),
      ).rejects.toThrow("text limit")
    }
    expect(values).toEqual([])
  })

  test("coalesces queued wheel input without crossing keys or direction changes", async () => {
    const fixture = protocol()
    await fixture.stream.configure(view)
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    fixture.hooks.set("Input.insertText", async () => {
      entered.resolve()
      await resume.promise
    })
    const first = fixture.stream.interact({ kind: "text", text: "first" })
    await entered.promise
    const wheel = { kind: "wheel", x: 0.8, y: 0.8, modifiers: 0, deltaX: 0, deltaY: 2 } as const
    const inputs = Array.from({ length: 120 }, () => fixture.stream.interact(wheel))
    inputs.push(
      fixture.stream.interact({
        kind: "key",
        action: "down",
        key: "Tab",
        code: "Tab",
        keyCode: 9,
        modifiers: 0,
        repeat: false,
      }),
      fixture.stream.interact({ ...wheel, deltaY: -4 }),
      fixture.stream.interact({ ...wheel, deltaY: 6 }),
      fixture.stream.interact({ ...wheel, deltaY: 5, modifiers: 2 }),
      fixture.stream.interact({ ...wheel, deltaY: 10000 }),
      fixture.stream.interact({ ...wheel, deltaY: 1 }),
    )
    resume.resolve()
    await Promise.all([first, ...inputs])
    const calls = fixture.calls.filter((call) => call.method.startsWith("Input."))
    expect(calls.map((call) => call.params?.deltaY ?? call.params?.key ?? call.params?.text)).toEqual([
      "first",
      240,
      "Tab",
      -4,
      6,
      5,
      10000,
      1,
    ])
  })

  test("drops old-sized JPEGs even when resize metadata is current", async () => {
    const fixture = protocol()
    await fixture.stream.configure(view)
    fixture.send(1, jpeg(view.width, 5).toString("base64"))
    fixture.send(2, Buffer.from("invalid image").toString("base64"))
    expect(fixture.frames).toEqual([])
    fixture.send(3)
    expect(fixture.frames).toHaveLength(1)
    expect(fixture.frames.at(0)).toMatchObject({ width: view.width, height: view.height })
  })

  test("drops oversized frames including a one-byte overflow with the same base64 length", async () => {
    const fixture = protocol()
    await fixture.stream.configure(view)
    fixture.send(1, jpeg(view.width, view.height, 2 * 1024 * 1024).toString("base64"))
    fixture.send(2, jpeg(view.width, view.height, 2 * 1024 * 1024 + 1).toString("base64"))
    fixture.send(3, jpeg(view.width, view.height, 2 * 1024 * 1024 + 8).toString("base64"))
    expect(fixture.frames).toHaveLength(1)
    expect(Buffer.byteLength(fixture.frames.at(0)!.data, "base64")).toBe(2 * 1024 * 1024)
    fixture.stream.acknowledge(1)
    expect(fixture.frames).toHaveLength(1)
    expect(fixture.calls.filter((call) => call.method === "Page.screencastFrameAck")).toHaveLength(3)
    expect(fixture.logs).toEqual([])
  })

  test("discards queued frames and stale acknowledgements on identity and revision changes", async () => {
    const fixture = protocol()
    await fixture.stream.configure(view)
    fixture.send(1)
    fixture.send(2)
    fixture.scope.navigation++
    fixture.stream.acknowledge(1)
    expect(fixture.frames).toHaveLength(1)
    fixture.send(3)
    fixture.send(4)
    fixture.scope.browserId = "replacement"
    fixture.stream.acknowledge(3)
    expect(fixture.frames).toHaveLength(2)
    fixture.send(5)
    fixture.send(6)
    await fixture.stream.configure({ ...view, revision: 2 })
    fixture.stream.acknowledge(5)
    expect(fixture.frames).toHaveLength(3)
    fixture.send(7)
    fixture.send(8, undefined, { ...view, width: 320 })
    expect(
      fixture.frames.map(({ browserId, navigation, revision, sequence }) => ({
        browserId,
        navigation,
        revision,
        sequence,
      })),
    ).toEqual([
      { browserId: "browser", navigation: 1, revision: 1, sequence: 1 },
      { browserId: "browser", navigation: 2, revision: 1, sequence: 3 },
      { browserId: "replacement", navigation: 2, revision: 1, sequence: 5 },
      { browserId: "replacement", navigation: 2, revision: 2, sequence: 7 },
    ])
  })

  test("allows only suspension at the current revision, including during an asynchronous start", async () => {
    const fixture = protocol()
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    fixture.hooks.set("Page.startScreencast", async () => {
      entered.resolve()
      await resume.promise
    })
    const configuring = fixture.stream.configure(view)
    await entered.promise
    fixture.send(1)
    fixture.send(2)
    const paused = fixture.stream.configure({ ...view, width: 320, height: 240, active: false })
    fixture.send(3)
    resume.resolve()
    await Promise.all([configuring, paused])
    expect(fixture.calls.filter((call) => call.method === "Page.stopScreencast")).toHaveLength(1)
    expect(fixture.calls.filter((call) => call.method === "resize").map((call) => call.params)).toEqual([
      { width: view.width, height: view.height },
    ])
    fixture.stream.acknowledge(1)
    expect(fixture.frames.map((frame) => frame.sequence)).toEqual([1])
    const count = fixture.calls.length
    for (const revision of [0, 1]) {
      for (const active of [false, true]) {
        await fixture.stream.configure({ ...view, width: 320, height: 240, revision, active })
      }
    }
    await fixture.stream.interact({ kind: "text", text: "ignored while suspended" })
    expect(fixture.calls).toHaveLength(count)
    const next = { ...view, width: 800, height: 600, revision: 2 }
    await fixture.stream.configure(next)
    fixture.send(4, undefined, next)
    const frame = fixture.frames.at(-1)
    expect([frame?.revision, frame?.width, frame?.height]).toEqual([2, 800, 600])
    expect(fixture.calls.filter((call) => call.method === "Page.startScreencast")).toHaveLength(2)
    await fixture.stream.configure({ ...view, active: false })
    expect(fixture.calls.filter((call) => call.method === "Page.stopScreencast")).toHaveLength(1)
  })

  test.each(["connect", "Page.startScreencast", "Page.stopScreencast"])("closes safely during %s", async (method) => {
    const fixture = protocol()
    if (method === "Page.stopScreencast") await fixture.stream.configure(view)
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    fixture.hooks.set(method, async () => {
      entered.resolve()
      await resume.promise
    })
    const configuring = fixture.stream.configure({ ...view, revision: 2, active: method !== "Page.stopScreencast" })
    await entered.promise
    const closing = fixture.stream.close()
    fixture.send(1)
    resume.resolve()
    await Promise.all([configuring, closing, fixture.stream.close()])
    expect(fixture.frames).toHaveLength(0)
    expect(fixture.calls.filter((call) => call.method === "detach")).toHaveLength(1)
    expect(fixture.session.listenerCount("Page.screencastFrame")).toBe(0)
    expect(fixture.page.listenerCount("close")).toBe(0)
    expect(fixture.page.listenerCount("framenavigated")).toBe(0)
    if (method === "Page.startScreencast") {
      expect(fixture.calls.map((call) => call.method).slice(-2)).toEqual(["Page.stopScreencast", "detach"])
    }
    const count = fixture.calls.length
    await fixture.stream.configure({ ...view, revision: 99 })
    await fixture.stream.interact({ kind: "text", text: "ignored" })
    fixture.send(2)
    expect(fixture.calls).toHaveLength(count)
  })

  test("handles a rejected start after close and still detaches", async () => {
    const fixture = protocol()
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    fixture.hooks.set("Page.startScreencast", async () => {
      entered.resolve()
      await resume.promise
      throw new Error("Target closed during start")
    })
    const configuring = fixture.stream.configure(view)
    await entered.promise
    const closing = fixture.stream.close()
    resume.resolve()
    await Promise.all([configuring, closing])
    expect(fixture.calls.map((call) => call.method).slice(-2)).toEqual(["Page.stopScreencast", "detach"])
    expect(fixture.session.listenerCount("Page.screencastFrame")).toBe(0)
  })

  test("drops superseded input and bounds failure logs without frame or text contents", async () => {
    const fixture = protocol()
    await fixture.stream.configure(view)
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    fixture.hooks.set("Input.insertText", async () => {
      entered.resolve()
      await resume.promise
    })
    const first = fixture.stream.interact({ kind: "text", text: "first" })
    await entered.promise
    const stale = fixture.stream.interact({ kind: "text", text: "stale" })
    fixture.scope.navigation++
    fixture.page.emit("framenavigated", fixture.page)
    resume.resolve()
    await Promise.all([first, stale])
    expect(fixture.calls.filter((call) => call.method === "Input.insertText").map((call) => call.params?.text)).toEqual(
      ["first"],
    )
    const secret = Buffer.concat([jpeg(), Buffer.from("private frame pixels")]).toString("base64")
    fixture.delivery.fail = true
    fixture.send(1, secret)
    fixture.delivery.fail = false
    fixture.send(2)
    expect(fixture.frames).toHaveLength(1)
    fixture.hooks.set("Page.screencastFrameAck", async () => {
      throw new Error(secret)
    })
    const text = "private input text".repeat(10000)
    fixture.hooks.set("detach", async () => {
      throw new Error(text)
    })
    fixture.send(3, secret)
    await fixture.stream.close()
    expect(JSON.stringify(fixture.logs)).not.toContain(secret)
    expect(JSON.stringify(fixture.logs)).not.toContain("private input text")
    expect(fixture.logs.flat().every((value) => typeof value === "string" && value.length <= 80)).toBe(true)
  })
})

describe.skipIf(!executable)("BrowserStream Chromium", () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch({
      executablePath: executable,
      headless: true,
      chromiumSandbox: true,
      args: ["--force-device-scale-factor=2"],
    })
  }, 20000)

  afterAll(async () => {
    await browser?.close()
  })

  async function fixture() {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 2 })
    pages.push(page)
    await page.setContent(`
      <style>body { margin: 0; min-height: 2400px } input, textarea { display: block; margin: 20px; width: 240px; height: 30px } #editable, #protected, #plain { margin: 20px }</style>
      <input id="input">
      <textarea id="area">one two</textarea>
      <input id="password" type="password" value="test-password">
      <input id="readonly" readonly value="read only">
      <div id="editable" contenteditable>editable text</div>
      <div id="protected" contenteditable>first <span contenteditable="false">protected</span> last</div>
      <p id="plain" tabindex="0">plain text</p>
    `)
    await page.evaluate(() => {
      const events: Record<string, unknown>[] = []
      for (const type of [
        "mousedown",
        "mouseup",
        "mousemove",
        "wheel",
        "keydown",
        "keyup",
        "input",
        "compositionstart",
        "compositionend",
      ]) {
        document.addEventListener(type, (event) => {
          const key = event as KeyboardEvent
          const mouse = event as MouseEvent
          events.push({
            type,
            key: key.key,
            code: key.code,
            keyCode: key.keyCode,
            ctrl: key.ctrlKey,
            shift: key.shiftKey,
            buttons: mouse.buttons,
            x: mouse.clientX,
            y: mouse.clientY,
          })
          document.body.dataset.events = JSON.stringify(events)
        })
      }
    })
    const frames: BrowserFrame[] = []
    const events = new EventEmitter()
    const logs: unknown[][] = []
    const scope = { browserId: "existing-page", navigation: 1 }
    const stream = new BrowserStream(
      page,
      () => scope,
      (frame) => {
        frames.push(frame)
        events.emit("frame", frame)
      },
      (...args) => logs.push(args),
    )
    streams.push(stream)
    const next = (predicate: (frame: BrowserFrame) => boolean = () => true) => {
      const found = frames.find(predicate)
      if (found) return Promise.resolve(found)
      const result = Promise.withResolvers<BrowserFrame>()
      const listener = (frame: BrowserFrame) => {
        if (!predicate(frame)) return
        events.off("frame", listener)
        result.resolve(frame)
      }
      events.on("frame", listener)
      return result.promise
    }
    const recorded = () =>
      page.evaluate(() => JSON.parse(document.body.dataset.events ?? "[]") as Record<string, unknown>[])
    return { page, stream, frames, next, recorded, logs, scope }
  }

  async function select(page: Page, selector: string, start = 0, end?: number) {
    await page.locator(selector).evaluate(
      (element, range) => {
        const node = element as HTMLInputElement
        node.focus()
        node.setSelectionRange(range.start, range.end ?? node.value.length)
      },
      { start, end },
    )
  }

  async function dom(page: Page, selector: string) {
    await page.locator(selector).evaluate((element) => {
      ;(element as HTMLElement).focus()
      document.getSelection()?.selectAllChildren(element)
    })
  }

  test("streams bounded JPEGs from the existing page and honors monotonic viewport revisions", async () => {
    const { stream, page, next, frames } = await fixture()
    await stream.configure({ ...view, width: 1, height: 9999, revision: 0, active: false })
    expect(page.viewportSize()).toEqual({ width: 32, height: 2160 })
    await stream.configure({ ...view, width: 9999, height: 1, active: false })
    expect(page.viewportSize()).toEqual({ width: 4096, height: 32 })
    await stream.configure({ ...view, revision: 0 })
    await stream.configure(view)
    expect(page.viewportSize()).toEqual({ width: 4096, height: 32 })
    expect(frames).toHaveLength(0)
    await stream.configure({ ...view, width: 640.4, height: 480.2, revision: 2 })
    const frame = await next()
    expect([frame.browserId, frame.navigation, frame.revision, frame.width, frame.height]).toEqual([
      "existing-page",
      1,
      2,
      640,
      480,
    ])
    const bytes = Buffer.from(frame.data, "base64")
    expect(bytes.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect([...bytes.subarray(0, 2)]).toEqual([255, 216])
    expect(
      await page.evaluate(async (data) => {
        const image = new Image()
        image.src = `data:image/jpeg;base64,${data}`
        await image.decode()
        return [image.naturalWidth, image.naturalHeight]
      }, frame.data),
    ).toEqual([640, 480])
    expect(page.context().pages()).toHaveLength(1)
    await stream.configure({ ...view, revision: 3, active: false })
    const count = frames.length
    stream.acknowledge(frame.sequence)
    await stream.interact({ kind: "text", text: "inactive" })
    await page.screenshot()
    expect(frames).toHaveLength(count)
    await stream.configure({ ...view, revision: 4 })
    const resumed = await next((frame) => frame.revision === 4)
    expect(resumed.sequence).toBeGreaterThan(frame.sequence)
    await stream.close()
    expect(page.isClosed()).toBe(false)
    expect(await page.locator("#input").inputValue()).toBe("")
  }, 10000)

  test("streams Retina pixels while keeping input and scrolling in CSS coordinates", async () => {
    const { stream, page, next } = await fixture()
    await stream.configure({ ...view, width: 320, height: 240, scale: 2 })
    const frame = await next()
    expect([frame.width, frame.height]).toEqual([640, 480])
    expect(
      await page.evaluate(async (data) => {
        const image = new Image()
        image.src = `data:image/jpeg;base64,${data}`
        await image.decode()
        return [image.naturalWidth, image.naturalHeight, innerWidth, innerHeight, devicePixelRatio]
      }, frame.data),
    ).toEqual([640, 480, 320, 240, 2])
    const point = { kind: "pointer", x: 60 / 320, y: 35 / 240, button: "left", clicks: 1, modifiers: 0 } as const
    await stream.interact({ ...point, action: "down", buttons: 1 })
    await stream.interact({ ...point, action: "up", buttons: 0 })
    await stream.interact({ kind: "text", text: "Retina input" })
    expect(await page.locator("#input").inputValue()).toBe("Retina input")
    await stream.interact({ kind: "wheel", x: 0.9, y: 0.9, deltaX: 0, deltaY: 200, modifiers: 0 })
    await page.waitForFunction(() => scrollY === 200)
    await stream.configure({ ...view, width: 384, height: 256, scale: 1.5, revision: 2 })
    const resized = await next((frame) => frame.revision === 2)
    expect([resized.width, resized.height]).toEqual([576, 384])
    expect(await page.evaluate(() => [innerWidth, innerHeight, scrollY])).toEqual([384, 256, 200])
  }, 10000)

  test("continues streaming on the same page after navigation without an old UI acknowledgement", async () => {
    const { stream, page, next, scope } = await fixture()
    await stream.configure(view)
    const first = await next()
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) scope.navigation++
    })
    await page.goto(
      `data:text/html,${encodeURIComponent('<title>Stream navigation</title><body style="background:rgb(20,80,160)">New page</body>')}`,
    )
    const current = await next((frame) => frame.navigation === 2)
    expect(current.sequence).toBeGreaterThan(first.sequence)
    expect(current.browserId).toBe(first.browserId)
    expect(current.revision).toBe(first.revision)
    expect(await page.title()).toBe("Stream navigation")
    stream.acknowledge(first.sequence)
    expect(page.context().pages()).toHaveLength(1)
  }, 10000)

  test("dispatches pointer, raw keys, text and wheel in order and releases held input", async () => {
    const { stream, page, recorded } = await fixture()
    await stream.configure(view)
    const pointer = {
      kind: "pointer",
      x: 60 / 640,
      y: 35 / 480,
      button: "left",
      buttons: 1,
      clicks: 1,
      modifiers: 0,
    } as const
    await stream.interact({ ...pointer, action: "down" })
    await stream.interact({ ...pointer, action: "up", buttons: 0 })
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("input")
    const key = { kind: "key", key: "a", code: "KeyA", keyCode: 65, modifiers: 0, repeat: false } as const
    await Promise.all([
      stream.interact({ ...key, action: "down" }),
      stream.interact({ kind: "text", text: "a" }),
      stream.interact({ ...key, action: "up" }),
    ])
    expect(await page.locator("#input").inputValue()).toBe("a")
    expect(
      (await recorded())
        .filter((event) => ["keydown", "input", "keyup"].includes(String(event.type)))
        .map((event) => event.type),
    ).toEqual(["keydown", "input", "keyup"])
    expect((await recorded()).find((event) => event.type === "keydown")).toMatchObject({
      key: "a",
      code: "KeyA",
      keyCode: 65,
    })
    await stream.interact({ ...key, action: "down", key: "Backspace", code: "Backspace", keyCode: 8 })
    await stream.interact({ ...key, action: "up", key: "Backspace", code: "Backspace", keyCode: 8 })
    expect(await page.locator("#input").inputValue()).toBe("")
    await stream.interact({ ...key, action: "down", key: "Control", code: "ControlLeft", keyCode: 17, modifiers: 2 })
    await stream.interact({ ...pointer, action: "down", modifiers: 10 })
    await stream.interact({ ...pointer, action: "move", buttons: 0, modifiers: 10 })
    await stream.interact({ kind: "release" })
    const events = await recorded()
    expect(events.filter((event) => event.type === "mouseup").at(-1)?.buttons).toBe(0)
    expect(events.filter((event) => event.type === "keyup").map((event) => event.key)).toContain("Control")
    expect(events.filter((event) => event.type === "keyup").at(-1)).toMatchObject({
      key: "Shift",
      ctrl: false,
      shift: false,
    })
    await stream.interact({ kind: "wheel", x: 0.8, y: 0.8, deltaX: 0, deltaY: 300, modifiers: 0 })
    await page.waitForFunction(() => window.scrollY > 0)
  }, 10000)

  test.each(["keydown", "keypress"])("respects cancelled printable %s events", async (type) => {
    const { stream, page } = await fixture()
    await stream.configure(view)
    await page.locator("#input").focus()
    const key = { kind: "key", key: "a", code: "KeyA", keyCode: 65, modifiers: 0, repeat: false } as const
    const press = () =>
      Promise.all([stream.interact({ ...key, action: "down", text: "a" }), stream.interact({ ...key, action: "up" })])
    await press()
    expect(await page.locator("#input").inputValue()).toBe("a")
    await page.evaluate((type) => {
      document.addEventListener(type, (event) => event.preventDefault())
    }, type)
    await press()
    expect(await page.locator("#input").inputValue()).toBe("a")
  })

  test("types shifted, AltGraph, and Unicode characters through native key events", async () => {
    const { stream, page } = await fixture()
    await stream.configure(view)
    await page.locator("#input").focus()
    for (const key of [
      { key: "A", code: "KeyA", keyCode: 65, modifiers: 8 },
      { key: "é", code: "KeyE", keyCode: 69, modifiers: 1 },
      { key: "€", code: "KeyE", keyCode: 69, modifiers: 3 },
      { key: "𠮷", code: "", keyCode: 0, modifiers: 0 },
    ]) {
      await stream.interact({ kind: "key", action: "down", ...key, text: key.key, repeat: false })
      await stream.interact({ kind: "key", action: "up", ...key, repeat: false })
    }
    expect(await page.locator("#input").inputValue()).toBe("Aé€𠮷")
  })

  test("handles Enter and select-all without bypassing page keyboard handlers", async () => {
    const { stream, page } = await fixture()
    await stream.configure(view)
    await page.locator("#area").fill("first")
    await select(page, "#area", 5, 5)
    const enter = { kind: "key", key: "Enter", code: "Enter", keyCode: 13, modifiers: 0, repeat: false } as const
    await stream.interact({ ...enter, action: "down" })
    await stream.interact({ ...enter, action: "up" })
    expect(await page.locator("#area").inputValue()).toBe("first\n")
    const all = { ...enter, key: "a", code: "KeyA", keyCode: 65, modifiers: process.platform === "darwin" ? 4 : 2 }
    await stream.interact({ ...all, action: "down" })
    await stream.interact({ ...all, action: "up" })
    expect(await stream.interact({ kind: "clipboard", action: "copy" })).toBe("first\n")
    await page.evaluate(() => {
      document.addEventListener("keydown", (event) => {
        if (event.key === "Enter") event.preventDefault()
      })
    })
    await stream.interact({ ...enter, action: "down" })
    await stream.interact({ ...enter, action: "up" })
    expect(await page.locator("#area").inputValue()).toBe("first\n")
  })

  test.each(["inactive", "suspended", "closed"])("releases held keys and buttons when %s", async (state) => {
    const { stream, page, recorded } = await fixture()
    await stream.configure(view)
    await stream.interact({
      kind: "key",
      action: "down",
      key: "Shift",
      code: "ShiftRight",
      keyCode: 16,
      modifiers: 8,
      repeat: false,
    })
    await stream.interact({
      kind: "pointer",
      action: "down",
      x: 0.1,
      y: 0.1,
      button: "left",
      buttons: 1,
      clicks: 1,
      modifiers: 8,
    })
    if (state === "inactive") await stream.configure({ ...view, active: false, revision: 2 })
    if (state === "suspended") {
      await stream.configure({ ...view, width: 800, height: 600, active: false })
      expect(page.viewportSize()).toEqual({ width: view.width, height: view.height })
    }
    if (state === "closed") await stream.close()
    const events = await recorded()
    expect(events.filter((event) => event.type === "mouseup").at(-1)?.buttons).toBe(0)
    expect(events.filter((event) => event.type === "keyup").at(-1)).toMatchObject({
      key: "Shift",
      code: "ShiftRight",
      shift: false,
    })
    expect(page.isClosed()).toBe(false)
  })

  test("updates, commits and cancels IME composition without duplicate text", async () => {
    const { stream, page, recorded } = await fixture()
    await stream.configure(view)
    await page.locator("#input").focus()
    await stream.interact({ kind: "composition", text: "に", start: 1, end: 1 })
    expect(await page.locator("#input").inputValue()).toBe("に")
    await stream.interact({ kind: "composition", text: "日本", start: 2, end: 2 })
    await stream.interact({ kind: "text", text: "日本" })
    expect(await page.locator("#input").inputValue()).toBe("日本")
    await stream.interact({ kind: "composition", text: "語", start: 1, end: 1 })
    await stream.interact({ kind: "release" })
    expect(await page.locator("#input").inputValue()).toBe("日本")
    expect((await recorded()).filter((event) => event.type === "compositionend")).toHaveLength(2)
  })

  test("honors cancelled and custom paste handlers before default text insertion", async () => {
    const { stream, page } = await fixture()
    await stream.configure(view)
    await page.locator("#input").evaluate((element) => {
      const node = element as HTMLInputElement
      node.addEventListener("paste", (event) => {
        const value = event.clipboardData?.getData("text/plain")
        node.dataset.pasted = value
        if (node.dataset.mode === "default") return
        event.preventDefault()
        if (node.dataset.mode === "custom") node.value = `custom:${value}`
      })
    })
    for (const mode of ["cancel", "custom", "default"]) {
      await page.locator("#input").fill("")
      await page.locator("#input").evaluate((node, value) => ((node as HTMLElement).dataset.mode = value), mode)
      await stream.interact({ kind: "clipboard", action: "paste" }, async () => "pasted")
      expect(await page.locator("#input").getAttribute("data-pasted")).toBe("pasted")
      expect(await page.locator("#input").inputValue()).toBe(
        mode === "cancel" ? "" : mode === "custom" ? "custom:pasted" : "pasted",
      )
    }
  })

  test.each(["copy", "cut"] as const)("honors cancelled and custom %s handlers", async (action) => {
    const { stream, page } = await fixture()
    await stream.configure(view)
    await page.locator("#input").fill("original")
    await select(page, "#input")
    await page.locator("#input").evaluate((node, type) => {
      node.addEventListener(type, (event) => {
        event.preventDefault()
        if ((node as HTMLElement).dataset.custom)
          (event as ClipboardEvent).clipboardData?.setData("text/plain", "custom")
      })
    }, action)
    expect(await stream.interact({ kind: "clipboard", action })).toBeUndefined()
    await page.locator("#input").evaluate((node) => ((node as HTMLElement).dataset.custom = "true"))
    expect(await stream.interact({ kind: "clipboard", action })).toBe("custom")
    expect(await page.locator("#input").inputValue()).toBe("original")
  })

  test("keeps password exclusion after a clipboard handler changes the field type", async () => {
    const { stream, page } = await fixture()
    await stream.configure(view)
    await page.locator("#input").fill("private value")
    await page.locator("#input").evaluate((element) => {
      const node = element as HTMLInputElement
      for (const type of ["copy", "cut"]) node.addEventListener(type, () => (node.type = "password"))
    })
    for (const action of ["copy", "cut"] as const) {
      await page.locator("#input").evaluate((node) => ((node as HTMLInputElement).type = "text"))
      await select(page, "#input")
      expect(await stream.interact({ kind: "clipboard", action })).toBeUndefined()
      expect(await page.locator("#input").inputValue()).toBe("private value")
    }
  })

  test("copies and cuts only eligible selections without reading the OS clipboard or passwords", async () => {
    const { stream, page } = await fixture()
    await stream.configure(view)
    await page.locator("#input").fill("hello world")
    await select(page, "#input", 1, 4)
    expect(await stream.interact({ kind: "clipboard", action: "copy" })).toBe("ell")
    expect(await page.locator("#input").inputValue()).toBe("hello world")
    expect(await stream.interact({ kind: "clipboard", action: "cut" })).toBe("ell")
    expect(await page.locator("#input").inputValue()).toBe("ho world")
    await select(page, "#area", 0, 3)
    expect(await stream.interact({ kind: "clipboard", action: "cut" })).toBe("one")
    expect(await page.locator("#area").inputValue()).toBe(" two")
    await select(page, "#readonly", 0, 4)
    expect(await stream.interact({ kind: "clipboard", action: "cut" })).toBe("read")
    expect(await page.locator("#readonly").inputValue()).toBe("read only")
    await select(page, "#password")
    expect(await stream.interact({ kind: "clipboard", action: "copy" })).toBeUndefined()
    expect(await stream.interact({ kind: "clipboard", action: "cut" })).toBeUndefined()
    expect(await page.locator("#password").inputValue()).toBe("test-password")
    await dom(page, "#plain")
    expect(await stream.interact({ kind: "clipboard", action: "cut" })).toBe("plain text")
    expect(await page.locator("#plain").textContent()).toBe("plain text")
    await dom(page, "#protected")
    expect(await stream.interact({ kind: "clipboard", action: "cut" })).toBe("first protected last")
    expect(await page.locator("#protected").textContent()).toBe("first protected last")
    await dom(page, "#editable")
    expect(await stream.interact({ kind: "clipboard", action: "cut" })).toBe("editable text")
    expect(await page.locator("#editable").textContent()).toBe("")
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        get: () => {
          throw new Error("Clipboard must not be read")
        },
      })
    })
    await expect(stream.interact({ kind: "clipboard", action: "paste" })).rejects.toThrow("Clipboard access")
    await page.locator("#input").fill("x".repeat(65537))
    await select(page, "#input")
    await expect(stream.interact({ kind: "clipboard", action: "cut" })).rejects.toThrow("text limit")
    expect((await page.locator("#input").inputValue()).length).toBe(65537)
  }, 10000)

  test("uses the focused iframe and shadow input for clipboard events", async () => {
    const { stream, page } = await fixture()
    await page.setContent(
      '<iframe srcdoc="<input value=inactive>"></iframe><iframe name="focused" sandbox="allow-scripts" srcdoc="<div id=host></div>"></iframe>',
    )
    await stream.configure(view)
    const child = page.frameLocator('iframe[name="focused"]')
    await child.locator("#host").evaluate((node) => {
      const root = node.attachShadow({ mode: "open" })
      root.innerHTML = '<input value="frame selection">'
      const input = root.querySelector("input")!
      input.focus()
      input.setSelectionRange(0, 5)
    })
    expect(await stream.interact({ kind: "clipboard", action: "copy" })).toBe("frame")
    expect(await stream.interact({ kind: "clipboard", action: "cut" })).toBe("frame")
    expect(await child.locator("input").inputValue()).toBe(" selection")
    await child.locator("input").evaluate((node) => {
      node.addEventListener("paste", (event) => {
        event.preventDefault()
        node.setAttribute("data-pasted", (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "")
      })
    })
    await stream.interact({ kind: "clipboard", action: "paste" }, async () => "into frame")
    expect(await child.locator("input").getAttribute("data-pasted")).toBe("into frame")
    expect(await child.locator("input").inputValue()).toBe(" selection")
  })

  test("rejects invalid viewports, coordinates, ranges and text lengths before dispatch", async () => {
    const { stream, page, recorded } = await fixture()
    await stream.configure(view)
    for (const change of [
      { width: NaN },
      { height: Infinity },
      { width: 0 },
      { height: -1 },
      { scale: NaN },
      { scale: Infinity },
      { scale: 0 },
      { revision: -1 },
      { revision: 1.5 },
      { active: "yes" },
    ]) {
      await expect(stream.configure({ ...view, revision: 2, ...change } as typeof view)).rejects.toThrow(
        "Invalid browser viewport",
      )
    }
    const pointer = { kind: "pointer", action: "move", x: 0, y: 0, button: "left", buttons: 0, clicks: 0, modifiers: 0 }
    const invalid = [
      null,
      { kind: "unknown" },
      ...[
        { x: NaN },
        { y: Infinity },
        { x: -0.1 },
        { y: 1.1 },
        { buttons: 8 },
        { clicks: 4 },
        { modifiers: 16 },
        { button: "unknown" },
      ].map((change) => ({ ...pointer, ...change })),
      { kind: "wheel", x: 0, y: 0, deltaX: 0, deltaY: 10001, modifiers: 0 },
      { kind: "key", action: "down", key: "a", code: "KeyA", keyCode: 256, modifiers: 0, repeat: false },
      { kind: "key", action: "down", key: "a", code: "KeyA", keyCode: 65, modifiers: 0, repeat: "yes" },
      { kind: "key", action: "down", key: "a", code: "KeyA", keyCode: 65, modifiers: 0, repeat: false, text: 1 },
      {
        kind: "key",
        action: "down",
        key: "a",
        code: "KeyA",
        keyCode: 65,
        modifiers: 0,
        repeat: false,
        text: "a".repeat(65),
      },
      { kind: "text", text: "x".repeat(65537) },
      { kind: "composition", text: "ab", start: 2, end: 1 },
      { kind: "composition", text: "ab", start: 0, end: 3 },
      { kind: "clipboard", action: "read" },
    ]
    for (const input of invalid) {
      await expect(stream.interact(input as BrowserInteraction)).rejects.toThrow("Invalid browser interaction")
    }
    expect(await recorded()).toEqual([])
    expect(page.viewportSize()).toEqual({ width: 640, height: 480 })
    await stream.interact({ ...pointer, x: 1, y: 1 } as BrowserInteraction)
    expect((await recorded()).at(-1)).toMatchObject({ type: "mousemove", x: 639, y: 479 })
    await stream.close()
    await stream.interact({ kind: "text", text: "closed" })
    expect(await page.locator("#input").inputValue()).toBe("")
  }, 10000)
})
