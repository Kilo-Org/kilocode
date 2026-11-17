import path from "node:path"

const win = path.win32

/** How Kilo starts the browser: a system channel, or the Playwright-installed Chromium build. */
export type Target = { channel: "chrome" | "msedge" } | { executablePath: string }

export type Input = {
  platform: NodeJS.Platform
  home: string
  env: Record<string, string | undefined>
  exists: (candidate: string) => boolean
  /** `chromium.executablePath()` of the bundled playwright-core build. */
  chromium?: string
}

export const INSTALL_HINT = "npx @playwright/mcp@0.0.81 install-browser"

function chromePaths(input: Input) {
  if (input.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(input.home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ]
  }
  if (input.platform === "win32") {
    return [
      input.env["PROGRAMFILES"] && win.join(input.env["PROGRAMFILES"], "Google/Chrome/Application/chrome.exe"),
      input.env["PROGRAMFILES(X86)"] &&
        win.join(input.env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
      input.env["LOCALAPPDATA"] && win.join(input.env["LOCALAPPDATA"], "Google/Chrome/Application/chrome.exe"),
    ]
  }
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"]
}

function edgePaths(input: Input) {
  if (input.platform === "darwin") {
    return [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      path.join(input.home, "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    ]
  }
  if (input.platform === "win32") {
    return [
      input.env["PROGRAMFILES"] && win.join(input.env["PROGRAMFILES"], "Microsoft/Edge/Application/msedge.exe"),
      input.env["PROGRAMFILES(X86)"] &&
        win.join(input.env["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe"),
      input.env["LOCALAPPDATA"] && win.join(input.env["LOCALAPPDATA"], "Microsoft/Edge/Application/msedge.exe"),
    ]
  }
  return ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable", "/opt/microsoft/msedge/msedge"]
}

/**
 * System Chrome first, then Edge, then the Playwright-installed Chromium of the bundled
 * playwright-core. A Kilo-owned profile is applied by the caller; the user's own profile is never used.
 */
export function locate(input: Input): Target | undefined {
  const chrome = chromePaths(input).filter((candidate): candidate is string => candidate !== undefined)
  if (chrome.some(input.exists)) return { channel: "chrome" }
  const edge = edgePaths(input).filter((candidate): candidate is string => candidate !== undefined)
  if (edge.some(input.exists)) return { channel: "msedge" }
  if (input.chromium && input.exists(input.chromium)) return { executablePath: input.chromium }
  return undefined
}
