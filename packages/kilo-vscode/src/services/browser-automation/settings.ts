import * as os from "os"
import * as path from "path"
import { devices } from "playwright-core"

export const PLAYWRIGHT_OUTPUT_DIR = path.join(os.tmpdir(), "kilo-playwright-mcp")

// Pinned so a new release cannot rename the CLI flags below and break startup. Check the flags with
// `npx @playwright/mcp@<version> --help` before raising this.
export const PLAYWRIGHT_MCP = "@playwright/mcp@0.0.83"

// Browser build revisions of that release, used to find installed builds without starting npx. Raise them together
// with the pin. `npx -p @playwright/mcp@<version> playwright install --dry-run` prints them.
export const PLAYWRIGHT_REVISIONS = { chromium: 1247, firefox: 1553, webkit: 2368 } as const

// Canonical order.
const BROWSERS = ["chrome", "chromium", "msedge", "firefox", "webkit"] as const
export type PlaywrightBrowser = (typeof BROWSERS)[number]

/**
 * The browser, device, viewport, and window mode the Playwright MCP server runs
 * with. The agent chooses it at runtime, and no server runs until it has.
 */
export interface PlaywrightProfile {
  browser: PlaywrightBrowser
  device?: string
  viewport?: string
  headless: boolean
}

const VIEWPORT = /^(\d{2,4})x(\d{2,4})$/

function playwrightBrowser(value: unknown): PlaywrightBrowser | undefined {
  return BROWSERS.find((browser) => browser === value)
}

/**
 * Normalize the allowed-browsers setting. `legacy` is the old Use System Chrome
 * toggle, which decides the default while the list has no explicit value.
 */
export function playwrightBrowsers(value: unknown, legacy?: boolean): PlaywrightBrowser[] {
  const list = Array.isArray(value) ? BROWSERS.filter((browser) => value.includes(browser)) : []
  if (list.length > 0) return list
  return [legacy === false ? "chromium" : "chrome"]
}

/** Normalize a "WIDTHxHEIGHT" viewport, or return undefined when it is empty or invalid. */
function playwrightViewport(value: unknown): string | undefined {
  if (typeof value !== "string") return
  const match = VIEWPORT.exec(value.trim().toLowerCase())
  if (!match) return
  const width = Number(match[1])
  const height = Number(match[2])
  if (width < 64 || height < 64) return
  return `${width}x${height}`
}

/** Resolve a device name to the Playwright spelling. */
function playwrightDevice(value: unknown, browser: PlaywrightBrowser): string | undefined {
  // Playwright MCP starts without emulation when it does not know the device, so an unknown name must fail here.
  const name = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (!name) return
  const device = Object.keys(devices).find((key) => key.toLowerCase() === name)
  if (!device) {
    throw new Error(
      `Unknown device "${name.slice(0, 100)}". Use a Playwright device name such as "iPhone 15", "Pixel 7", or "iPad Pro 11".`,
    )
  }
  if (browser === "firefox" && devices[device]?.isMobile) {
    throw new Error("Firefox does not support mobile device emulation. Use another browser or omit device.")
  }
  return device
}

/**
 * Resolve the profile an agent asked for. Returns undefined when the request
 * only reads the current profile. The browser stays the same unless it is
 * named, while device, viewport, and headless mode reset unless they are passed
 * again. The window is visible unless headless is requested.
 */
export function playwrightRequest(
  body: { browser?: unknown; device?: unknown; viewport?: unknown; headless?: unknown },
  current: PlaywrightProfile | undefined,
  allowed: PlaywrightBrowser[],
): PlaywrightProfile | undefined {
  if (
    body.browser === undefined &&
    body.device === undefined &&
    body.viewport === undefined &&
    body.headless === undefined
  ) {
    return
  }
  if (body.browser === undefined && !current) {
    throw new Error(`No browser is running yet. Pass a browser to start one. Allowed browsers: ${allowed.join(", ")}.`)
  }
  const browser = body.browser === undefined ? current?.browser : playwrightBrowser(body.browser)
  if (!browser || !allowed.includes(browser)) {
    throw new Error(
      `Browser "${String(body.browser)}" is not allowed. Allowed browsers: ${allowed.join(", ")}. The user can change this in Kilo Settings > Web Tools.`,
    )
  }
  const device = playwrightDevice(body.device, browser)
  const viewport = playwrightViewport(body.viewport)
  if (body.viewport !== undefined && !viewport) throw new Error("Viewport must be WIDTHxHEIGHT, for example 1280x720.")
  return { browser, device, viewport, headless: body.headless === true }
}

/**
 * Build the Playwright MCP launch command.
 *
 * Default artifacts go outside the workspace. Explicit screenshot paths can
 * bypass this directory, so this is not a guarantee against staging artifacts.
 */
export function playwrightCommand(profile: PlaywrightProfile): string[] {
  const command = ["npx", PLAYWRIGHT_MCP]
  if (profile.headless) command.push("--headless")
  command.push("--browser", profile.browser)
  if (profile.device) command.push("--device", profile.device)
  if (profile.viewport) command.push("--viewport-size", profile.viewport)
  command.push("--output-dir", PLAYWRIGHT_OUTPUT_DIR)
  return command
}
