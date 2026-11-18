import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Frame, Page } from "playwright-core"
import { BrowserContract } from "../../src/browser/contract"
import { browsersDirectory, useKiloBrowsers } from "../../src/browser/install"
import {
  Backends,
  contained,
  FILE_TITLES,
  outputFile,
  retainScreenshots,
  snapshotBody,
  frameOrigin,
  insideOutput,
  screenshotPath,
  key,
  landingNeed,
  launchFailure,
  navigationRefusal,
  navigationTargets,
  plannedOrigin,
  prunePages,
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

describe("screenshot retention", () => {
  test("keeps a day and two hundred files, and never a user-named one", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "shots-"))
    const now = Date.now()
    for (let index = 0; index < 210; index += 1) {
      const file = path.join(directory, `page-2026-01-01T00-00-00-000Z-${String(index).padStart(3, "0")}.png`)
      await fs.writeFile(file, "x")
      // Newest first by index: index 0 is the newest.
      await fs.utimes(file, new Date(now - index * 1000), new Date(now - index * 1000))
    }
    const old = path.join(directory, "page-ancient.png")
    await fs.writeFile(old, "x")
    await fs.utimes(old, new Date(now - 25 * 60 * 60 * 1000), new Date(now - 25 * 60 * 60 * 1000))
    const user = path.join(directory, "my-screenshot.png")
    await fs.writeFile(user, "keep")
    await fs.utimes(user, new Date(now - 25 * 60 * 60 * 1000), new Date(now - 25 * 60 * 60 * 1000))
    await retainScreenshots(directory, now)
    const left = await fs.readdir(directory)
    expect(left.filter((name) => /^page-/.test(name)).length).toBe(200)
    expect(left).toContain("page-2026-01-01T00-00-00-000Z-000.png")
    expect(left).not.toContain("page-2026-01-01T00-00-00-000Z-209.png")
    expect(left).not.toContain("page-ancient.png")
    // A name the user chose is never the backend's to delete.
    expect(left).toContain("my-screenshot.png")
  })
})

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
  test("a relative file name resolves under the output directory, not the process cwd", () => {
    const directory = path.join(path.sep, "tmp", "browser", "output")
    expect(insideOutput("page.png", directory)).toBe(path.resolve(directory, "page.png"))
    expect(insideOutput("nested/page.png", directory)).toBe(path.resolve(directory, "nested", "page.png"))
    expect(() => insideOutput("../page.png", directory)).toThrow("output directory")
  })

  test("a result file is written by the backend from the filtered text, and the name never reaches the MCP", () => {
    const directory = path.join(path.sep, "tmp", "browser", "output")
    const file = outputFile("browser_snapshot", { filename: "nested/page.yml", other: 1 }, directory)
    expect(file?.path).toBe(path.resolve(directory, "nested/page.yml"))
    // The MCP's arguments no longer carry the name, so it cannot write an unfiltered copy.
    expect(file?.args).toEqual({ other: 1 })
    // Only the tools whose result can be a file take a name; a screenshot keeps its own path.
    expect(outputFile("browser_click", { filename: "x.yml" }, directory)).toBeUndefined()
    expect(outputFile("browser_take_screenshot", { filename: "shot.png" }, directory)).toBeUndefined()
    expect(outputFile("browser_snapshot", {}, directory)).toBeUndefined()
    expect(() => outputFile("browser_console_messages", { filename: "../out.log" }, directory)).toThrow(
      "output directory",
    )
  })

  test("every contract tool that takes a filename is written inside the output directory", () => {
    const directory = path.join(path.sep, "tmp", "browser", "output")
    const names = BrowserContract.entries
      .filter((entry) => "filename" in ((entry.inputSchema as { properties?: object }).properties ?? {}))
      .map((entry) => entry.name)
      .sort()
    // A contract bump that adds a file-writing tool fails here until it is handled.
    expect(names).toEqual([
      "browser_console_messages",
      "browser_evaluate",
      "browser_network_request",
      "browser_network_requests",
      "browser_run_code_unsafe",
      "browser_snapshot",
      "browser_take_screenshot",
    ])
    for (const name of names) {
      // Refused outright before a file could exist.
      if (name === "browser_run_code_unsafe") continue
      if (name === "browser_take_screenshot") {
        expect(screenshotPath(name, { filename: "shots/a.png" }, directory)).toBe(
          path.resolve(directory, "shots", "a.png"),
        )
        continue
      }
      expect(FILE_TITLES[name], `${name} has no file title`).toBeDefined()
      const file = outputFile(name, { filename: "nested/out.txt" }, directory)
      expect(file?.path).toBe(path.resolve(directory, "nested/out.txt"))
      // The MCP never receives the name.
      expect(file?.args).toEqual({})
    }
  })

  test("containment is separator- and case-correct on win32 and posix", () => {
    const win = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\kilo\\data\\kilo2\\browser\\output"
    expect(contained(`${win}\\page.png`, win, path.win32)).toBe(true)
    // A drive-letter or directory case difference is the same directory on Windows.
    expect(contained(`${win.toLowerCase()}\\nested\\page.png`, win, path.win32)).toBe(true)
    expect(contained(`${win}\\..\\escape.png`, win, path.win32)).toBe(false)
    expect(contained("D:\\other\\page.png", win, path.win32)).toBe(false)
    // A sibling with the same prefix is not inside.
    expect(contained(`${win}-other\\page.png`, win, path.win32)).toBe(false)
    expect(contained("/tmp/out/page.png", "/tmp/out", path.posix)).toBe(true)
    expect(contained("/tmp/out-other/page.png", "/tmp/out", path.posix)).toBe(false)
    expect(contained("/tmp/out", "/tmp/out", path.posix)).toBe(true)
    // Only a `..` segment escapes: `..foo` is an ordinary name.
    expect(contained("/tmp/out/..foo", "/tmp/out", path.posix)).toBe(true)
    expect(contained("/tmp/out/../x", "/tmp/out", path.posix)).toBe(false)
    expect(contained("/tmp/out/a/../../x", "/tmp/out", path.posix)).toBe(false)
    expect(contained("C:\\out\\..foo", "C:\\out", path.win32)).toBe(true)
    expect(contained("C:\\out\\..\\x", "C:\\out", path.win32)).toBe(false)
    expect(contained("C:\\out\\a\\..\\..\\x", "C:\\out", path.win32)).toBe(false)
  })

  test("a symlink target is resolved before containment, and a symlink is never written", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "output-link-"))
    const root = path.join(base, "output")
    const outside = path.join(base, "outside")
    await fs.mkdir(root, { recursive: true })
    await fs.mkdir(outside, { recursive: true })
    await fs.writeFile(path.join(outside, "secret.yml"), "secret")
    await fs.symlink(path.join(outside, "secret.yml"), path.join(root, "escape.yml"))
    // The name is inside the directory, but the target is not.
    expect(() => insideOutput("escape.yml", root)).toThrow("output directory")
    // A link that stays inside resolves to its target.
    await fs.writeFile(path.join(root, "real.yml"), "- real")
    await fs.symlink(path.join(root, "real.yml"), path.join(root, "alias.yml"))
    expect(insideOutput("alias.yml", root)).toBe(await fs.realpath(path.join(root, "real.yml")))
  })

  test("a snapshot file body is the YAML block the MCP writes", () => {
    const text = ["### Page", "- Page URL: https://a.example/", "### Snapshot", "```yaml", "- heading", "```"].join(
      "\n",
    )
    expect(snapshotBody(text)).toBe("- heading\n")
  })

  test("a nested screenshot name resolves inside the output directory", () => {
    const directory = path.join(path.sep, "tmp", "browser", "output")
    expect(screenshotPath("browser_take_screenshot", { filename: "nested/shot.png" }, directory)).toBe(
      path.resolve(directory, "nested", "shot.png"),
    )
  })

  test("a file name outside the backend's directory is refused", () => {
    const directory = path.join(path.sep, "tmp", "browser", "output")
    expect(insideOutput(path.join(directory, "page.png"), directory)).toBe(path.resolve(directory, "page.png"))
    expect(() => insideOutput(path.join(path.sep, "tmp", "elsewhere.png"), directory)).toThrow("output directory")
    expect(() => insideOutput("../../page.png", directory)).toThrow("output directory")
  })

  test("a screenshot may save inside the output directory, and is written from the masked image", () => {
    const directory = path.join(path.sep, "tmp", "browser", "output")
    // The path the model asked for is resolved up front; the MCP never writes it.
    expect(screenshotPath("browser_take_screenshot", { filename: path.join(directory, "shot.png") }, directory)).toBe(
      path.resolve(directory, "shot.png"),
    )
    expect(() => screenshotPath("browser_take_screenshot", { filename: "../../shot.png" }, directory)).toThrow(
      "output directory",
    )
    expect(screenshotPath("browser_take_screenshot", {}, directory)).toBeUndefined()
    expect(screenshotPath("browser_snapshot", { filename: "x" }, directory)).toBeUndefined()
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

  test("the hard cap is the last resort, and it drops the least recently used session", () => {
    const pages = new Map<string, Page>()
    for (let index = 0; index < 1100; index += 1) rememberPage(pages, `s${index}`, one)
    expect(pages.size).toBe(1024)
    expect(pages.has("s0")).toBe(false)
    expect(pages.has("s1099")).toBe(true)
    // A session that acts again moves to the back, so the fallback never evicts a recently active one.
    rememberPage(pages, "s1099", one)
    expect([...pages.keys()].at(-1)).toBe("s1099")
  })

  test("a deleted session releases its page on every live backend", async () => {
    const forgotten: string[] = []
    const backends = new Backends(async (value) => ({
      ...fake(value, []),
      forget: (session: string) => forgotten.push(session),
    }))
    await backends.get(key(resolve(undefined)))
    backends.forgetSession("ses_deleted")
    expect(forgotten).toEqual(["ses_deleted"])
  })

  test("sessions are evicted by liveness, so a live session keeps its page", () => {
    const pages = new Map<string, Page>()
    for (let index = 0; index < 100; index += 1) pages.set(`s${index}`, one)
    // A hundred sessions sharing one live page are all kept.
    prunePages(pages, [one])
    expect(pages.size).toBe(100)
    // Dead pages go, live ones stay.
    prunePages(pages, [])
    expect(pages.size).toBe(0)
    const mixed = new Map([
      ["live", one],
      ["dead", two],
    ])
    prunePages(mixed, [one])
    expect([...mixed.keys()]).toEqual(["live"])
  })

  test("an action that lands on an ungranted origin is withheld, and a granted one is not", () => {
    const authorized = ["act:https://shop.example.com", "read:https://shop.example.com"]
    expect(
      landingNeed({
        tool: "browser_click",
        planned: "https://shop.example.com",
        landed: "https://pay.example.net",
        authorized,
      }),
    ).toEqual({ class: "read", origin: "https://pay.example.net" })
    expect(
      landingNeed({
        tool: "browser_click",
        planned: "https://shop.example.com",
        landed: "https://pay.example.net",
        authorized: [...authorized, "read:https://pay.example.net"],
      }),
    ).toBeUndefined()
    // A read tool reports where it is; it does not need a new grant for it.
    expect(
      landingNeed({ tool: "browser_snapshot", planned: "https://a.example", landed: "https://b.example", authorized }),
    ).toBeUndefined()
    // Same origin needs nothing, and a navigation allowed to that origin may report it.
    expect(
      landingNeed({
        tool: "browser_click",
        planned: "https://shop.example.com",
        landed: "https://shop.example.com",
        authorized,
      }),
    ).toBeUndefined()
    expect(
      landingNeed({
        tool: "browser_navigate",
        planned: "https://old.example",
        landed: "https://new.example",
        authorized: ["navigate:https://new.example"],
      }),
    ).toBeUndefined()
    // navigate_back has no target of its own, so its plan is the page it left.
    expect(
      landingNeed({
        tool: "browser_navigate_back",
        planned: "https://pay.example.net",
        landed: "https://shop.example.com",
        authorized,
      }),
    ).toBeUndefined()
  })

  test("a navigation's plan is the url it asked to open, not the page it left", () => {
    expect(plannedOrigin("browser_navigate", { url: "https://shop.example.com/x" }, "https://old.example")).toBe(
      "https://shop.example.com",
    )
    expect(plannedOrigin("browser_tabs", { action: "new", url: "https://new.example/" }, "https://old.example")).toBe(
      "https://new.example",
    )
    expect(plannedOrigin("browser_click", { target: "e1" }, "https://shop.example.com")).toBe(
      "https://shop.example.com",
    )
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
