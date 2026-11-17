import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Frame, Page } from "playwright-core"
import { browsersDirectory, useKiloBrowsers } from "../../src/browser/install"
import {
  Backends,
  frameOrigin,
  insideOutput,
  screenshotPath,
  key,
  launchFailure,
  navigationRefusal,
  navigationTargets,
  outputBaseline,
  rememberPage,
  snapshotFile,
  tabChoice,
  withheldFrames,
} from "../../src/browser/playwright"
import { resolve } from "../../src/browser/settings"
import type { BrowserBackend } from "../../src/browser/backend"

type Fake = { node: Frame; kids: Fake[] }

function tree(url: string, parent: Fake | null = null): Fake {
  const kids: Fake[] = []
  const node = {
    url: () => url,
    parentFrame: () => parent?.node ?? null,
    childFrames: () => kids.map((kid) => kid.node),
  } as unknown as Frame
  return { node, kids }
}

function page(main: Fake): Page {
  return { mainFrame: () => main.node } as unknown as Page
}

describe("snapshot links", () => {
  test("a link relative to the MCP's working directory resolves inside the output directory", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "snapshot-link-"))
    const cwd = path.join(base, "project")
    const root = path.join(base, "data", "output")
    await fs.mkdir(path.join(root, "e2e"), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })
    const file = path.join(root, "e2e", "page.yml")
    await fs.writeFile(file, "- heading")
    // The MCP prints this path relative to its own cwd, not relative to the output directory.
    const link = path.relative(cwd, file)
    expect(await snapshotFile(link, root, cwd)).toBe(await fs.realpath(file))
    // A link that escapes the output directory is refused, even when the file exists.
    const outside = path.join(base, "secret.yml")
    await fs.writeFile(outside, "secret")
    expect(await snapshotFile(path.relative(cwd, outside), root, cwd)).toBeUndefined()
    // The output directory alone is the wrong base for a cwd-relative link.
    expect(await snapshotFile(link, root, root)).toBeUndefined()
  })
})

describe("withheld frames", () => {
  test("a frame nested in a withheld frame is withheld too", () => {
    const top = tree("https://shop.example.com/checkout")
    const pay = tree("https://pay.example.net/", top)
    const widget = tree("https://widget.example/", pay)
    top.kids.push(pay)
    pay.kids.push(widget)
    // The widget has its own read grant; the withheld ancestor still hides it.
    const withheld = withheldFrames(page(top), ["read:https://shop.example.com", "read:https://widget.example"])
    expect(withheld).toEqual([pay.node, widget.node])
  })

  test("about:blank and srcdoc frames belong to their parent's origin", () => {
    const top = tree("https://shop.example.com/")
    const blank = tree("about:blank", top)
    top.kids.push(blank)
    expect(frameOrigin(blank.node)).toBe("https://shop.example.com")
    expect(withheldFrames(page(top), ["read:https://shop.example.com"])).toEqual([])
  })

  test("a frame whose origin cannot be determined is withheld", () => {
    const blank = tree("about:blank")
    const child = tree("about:srcdoc", blank)
    blank.kids.push(child)
    expect(withheldFrames(page(blank), [])).toEqual([child.node])
  })

  test("an opaque frame cannot inherit a granted ancestor's origin", () => {
    const top = tree("https://shop.example.com/")
    const opaque = tree("data:text/html,<p>hidden</p>", top)
    const blob = tree("blob:https://shop.example.com/uuid", top)
    top.kids.push(opaque, blob)
    // The page is granted, but a document that navigated itself to `data:`/`blob:` has no origin to inherit.
    expect(frameOrigin(opaque.node)).toBeUndefined()
    expect(frameOrigin(blob.node)).toBeUndefined()
    expect(withheldFrames(page(top), ["read:https://shop.example.com"])).toEqual([opaque.node, blob.node])
  })
})

describe("url-taking tools", () => {
  test("a new tab is a navigation target like browser_navigate", () => {
    expect(navigationTargets("browser_navigate", { url: "https://shop.example.com/" })).toEqual([
      "https://shop.example.com/",
    ])
    expect(navigationTargets("browser_tabs", { action: "new", url: "file:///etc/passwd" })).toEqual([
      "file:///etc/passwd",
    ])
    expect(navigationTargets("browser_tabs", { action: "list" })).toEqual([])
    expect(navigationRefusal("file:///etc/passwd")).toContain("Navigation refused")
  })
})

describe("output directory", () => {
  test("a file name outside the backend's directory is refused", () => {
    const directory = path.join(path.sep, "tmp", "browser", "output")
    expect(insideOutput(path.join(directory, "page.png"), directory)).toBe(path.join(directory, "page.png"))
    expect(() => insideOutput(path.join(path.sep, "tmp", "elsewhere.png"), directory)).toThrow("output directory")
    expect(() => insideOutput("../../page.png", directory)).toThrow("output directory")
  })

  test("a screenshot may save inside the output directory, and is written from the masked image", () => {
    const directory = path.join(path.sep, "tmp", "browser", "output")
    // The path the model asked for is resolved up front; the MCP never writes it.
    expect(screenshotPath("browser_take_screenshot", { filename: path.join(directory, "shot.png") }, directory)).toBe(
      path.join(directory, "shot.png"),
    )
    expect(() => screenshotPath("browser_take_screenshot", { filename: "../../shot.png" }, directory)).toThrow(
      "output directory",
    )
    expect(screenshotPath("browser_take_screenshot", {}, directory)).toBeUndefined()
    expect(screenshotPath("browser_snapshot", { filename: "x" }, directory)).toBeUndefined()
  })

  test("a snapshot is baselined because it can be saved as a file", () => {
    expect(outputBaseline("browser_snapshot")).toBe(true)
  })
})

describe("current page", () => {
  const one = { id: 1 } as unknown as Page
  const two = { id: 2 } as unknown as Page
  const three = { id: 3 } as unknown as Page

  test("a tab created during the call becomes current", () => {
    expect(
      tabChoice({ known: one, before: [one], after: [one, two], name: "browser_tabs", args: { action: "new" } }),
    ).toBe(two)
  })

  test("the model's own index selects a tab, and tool text cannot", () => {
    expect(
      tabChoice({
        known: one,
        before: [one, two],
        after: [one, two],
        name: "browser_tabs",
        args: { action: "select", index: 1 },
      }),
    ).toBe(two)
    expect(tabChoice({ known: one, before: [one, two], after: [one, two], name: "browser_snapshot", args: {} })).toBe(
      one,
    )
  })

  test("the session page map is bounded and refreshes the entry it is given", () => {
    const pages = new Map<string, Page>()
    for (let index = 0; index < 70; index += 1) rememberPage(pages, `s${index}`, one, 64)
    expect(pages.size).toBe(64)
    expect(pages.has("s0")).toBe(false)
    expect(pages.has("s69")).toBe(true)
    // Re-remembering an existing session moves it to the back instead of duplicating it.
    rememberPage(pages, "s6", two, 64)
    expect(pages.size).toBe(64)
    expect([...pages.keys()].at(-1)).toBe("s6")
  })

  test("closing the current tab falls back to a live page", () => {
    expect(
      tabChoice({ known: one, before: [one, two], after: [two], name: "browser_tabs", args: { action: "close" } }),
    ).toBe(two)
    expect(
      tabChoice({ known: one, before: [one], after: [], name: "browser_tabs", args: { action: "close" } }),
    ).toBeUndefined()
  })
})

describe("navigation targets", () => {
  test("http(s) pages and about:blank may be opened", () => {
    expect(navigationRefusal("https://shop.example.com/checkout")).toBeUndefined()
    expect(navigationRefusal("http://localhost:3000/")).toBeUndefined()
    expect(navigationRefusal("about:blank")).toBeUndefined()
    expect(navigationRefusal("  about:blank  ")).toBeUndefined()
  })

  test("a scheme that reaches the machine or the browser itself is refused", () => {
    for (const url of [
      "file:///etc/passwd",
      "data:text/html,<p>hi</p>",
      "javascript:alert(1)",
      "chrome://settings",
      "view-source:file:///etc/passwd",
    ]) {
      const refusal = navigationRefusal(url)
      expect(refusal).toContain("Navigation refused")
      expect(refusal).toContain(new URL(url).protocol)
    }
  })

  test("a target that is not a URL is refused", () => {
    expect(navigationRefusal("not a url")).toContain("not a URL")
    expect(navigationRefusal("")).toContain("not a URL")
  })
})

describe("output baselines", () => {
  test("a screenshot is always baselined, even with nothing withheld yet", () => {
    expect(outputBaseline("browser_take_screenshot")).toBe(true)
  })

  test("results that can be saved as a file are baselined", () => {
    expect(outputBaseline("browser_network_request")).toBe(true)
    expect(outputBaseline("browser_network_requests")).toBe(true)
    expect(outputBaseline("browser_console_messages")).toBe(true)
  })

  test("a tool that writes nothing is not read", () => {
    expect(outputBaseline("browser_click")).toBe(false)
    expect(outputBaseline("browser_find")).toBe(false)
    expect(outputBaseline("browser_press_key")).toBe(false)
  })
})

describe("playwright launch failures", () => {
  test("names the sandbox fix instead of a raw stack", () => {
    const error = launchFailure(
      new Error("Chromium sandboxing failed! Use --no-sandbox to work around."),
      "/opt/ms-playwright/chromium-1234/chrome-linux/chrome",
    )
    expect(error.message).toContain("Chromium sandboxing failed!")
    expect(error.message).toContain("sudo chown root:root /opt/ms-playwright/chromium-1234/chrome-linux/chrome_sandbox")
    expect(error.message).toContain("sudo chmod 4755 /opt/ms-playwright/chromium-1234/chrome-linux/chrome_sandbox")
    expect(error.message).toContain("kernel.apparmor_restrict_unprivileged_userns=0")
    expect(error.message).toContain("never disabled")
    // The instruction is for Linux, so a Windows host still spells the path with forward slashes.
    expect(error.message).not.toContain("\\\\")
  })

  test("uses a placeholder path when the executable is unknown", () => {
    const error = launchFailure(new Error("sandbox is not permitted"))
    expect(error.message).toContain("<playwright-chromium>/chrome-linux/chrome_sandbox")
  })

  test("passes unrelated launch failures through unchanged", () => {
    const original = new Error("Executable doesn't exist at /opt/ms-playwright/chrome")
    expect(launchFailure(original)).toBe(original)
    expect(launchFailure("plain text")).toEqual(new Error("plain text"))
  })
})

describe("browser install location", () => {
  test("points playwright-core at the Kilo data dir", () => {
    const previous = process.env.PLAYWRIGHT_BROWSERS_PATH
    try {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH
      useKiloBrowsers()
      expect(process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? "").toBe(browsersDirectory())
      expect(browsersDirectory()).toEndWith(path.join("browser", "browsers"))
    } finally {
      if (previous === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
      else process.env.PLAYWRIGHT_BROWSERS_PATH = previous
    }
  })
})

function fake(id: string, closed: string[]): BrowserBackend {
  return {
    id: "playwright",
    contractSha: "",
    listTools: async () => [],
    callTool: async () => ({ content: [], isError: false }),
    dispose: async () => {
      closed.push(id)
    },
  }
}

describe("browser backend lifecycle", () => {
  test("one backend per configuration key", async () => {
    const created: string[] = []
    const backends = new Backends(async (value) => {
      created.push(value)
      return fake(value, [])
    })
    const settings = resolve(undefined)
    const [first, second] = await Promise.all([backends.get(key(settings)), backends.get(key(settings))])
    expect(first).toBe(second)
    expect(created).toEqual([key(settings)])
  })

  test("a different headless choice starts a second browser", async () => {
    const created: string[] = []
    const backends = new Backends(async (value) => {
      created.push(value)
      return fake(value, [])
    })
    await backends.get(key(resolve({ headless: true }, {})))
    await backends.get(key(resolve({ headless: false }, {})))
    expect(created.length).toBe(2)
  })

  test("losing the browser evicts it, so the next call creates a new one", async () => {
    let evict = () => {}
    const created: string[] = []
    const backends = new Backends(async (value, gone) => {
      created.push(value)
      evict = gone
      return fake(value, [])
    })
    const settings = resolve(undefined)
    const first = await backends.get(key(settings))
    evict()
    const second = await backends.get(key(settings))
    expect(second).not.toBe(first)
    expect(created.length).toBe(2)
  })

  test("a failed launch is not cached", async () => {
    let attempts = 0
    const backends = new Backends(async (value) => {
      attempts += 1
      if (attempts === 1) throw new Error("no browser")
      return fake(value, [])
    })
    const settings = resolve(undefined)
    await expect(backends.get(key(settings))).rejects.toThrow("no browser")
    await expect(backends.get(key(settings))).resolves.toBeDefined()
  })

  test("dispose closes a backend that is still launching", async () => {
    const closed: string[] = []
    let finish: ((backend: BrowserBackend) => void) | undefined
    const backends = new Backends(
      () =>
        new Promise<BrowserBackend>((resolve) => {
          finish = resolve
        }),
    )
    const pending = backends.get(key(resolve(undefined)))
    const closing = backends.dispose()
    finish?.(fake("late", closed))
    await pending
    await closing
    expect(closed.length).toBe(1)
  })

  test("dispose closes every live browser once", async () => {
    const closed: string[] = []
    const backends = new Backends(async (value) => fake(value, closed))
    await backends.get(key(resolve({ headless: true }, {})))
    await backends.get(key(resolve({ headless: false }, {})))
    await backends.dispose()
    expect(closed.length).toBe(2)
    await backends.dispose()
    expect(closed.length).toBe(2)
  })
})
