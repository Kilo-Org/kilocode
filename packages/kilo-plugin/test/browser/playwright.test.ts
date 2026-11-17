import { describe, expect, test } from "bun:test"
import { browsersDirectory, useKiloBrowsers } from "../../src/browser/install"
import { Backends, key, launchFailure } from "../../src/browser/playwright"
import { resolve } from "../../src/browser/settings"
import type { BrowserBackend } from "../../src/browser/backend"

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
