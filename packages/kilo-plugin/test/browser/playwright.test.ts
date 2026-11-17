import { describe, expect, test } from "bun:test"
import type { Frame, Page } from "playwright-core"
import { browsersDirectory, useKiloBrowsers } from "../../src/browser/install"
import {
  Backends,
  frameOrigin,
  key,
  launchFailure,
  navigationRefusal,
  outputBaseline,
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
    expect(outputBaseline("browser_snapshot")).toBe(false)
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
      expect(browsersDirectory()).toEndWith("/browser/browsers")
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
