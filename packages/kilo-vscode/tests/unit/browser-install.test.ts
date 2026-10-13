import { describe, expect, it } from "bun:test"
import { BrowserInstaller, advance, artifacts, reason } from "../../src/services/browser-automation/browser-install"

const CDN = "https://cdn.playwright.dev/builds"
const ROOT = "/cache/ms-playwright"

// What `playwright install --dry-run <browser>` prints for each build.
const DRY: Record<string, string> = {
  chromium: `Chrome for Testing 155.0.8059.12 (playwright chromium v1247)
  Install location:    ${ROOT}/chromium-1247
  Download url:        ${CDN}/cft/chrome-linux64.zip

FFmpeg (playwright ffmpeg v1011)
  Install location:    ${ROOT}/ffmpeg-1011
  Download url:        ${CDN}/ffmpeg/ffmpeg-linux.zip
  Download fallback 1: https://playwright.download.prss.microsoft.com/ffmpeg-linux.zip

Chrome Headless Shell 155.0.8059.12 (playwright chromium-headless-shell v1247)
  Install location:    ${ROOT}/chromium_headless_shell-1247
  Download url:        ${CDN}/cft/chrome-headless-shell-linux64.zip
`,
  firefox: `Firefox 156.0 (playwright firefox v1553)
  Install location:    ${ROOT}/firefox-1553
  Download url:        ${CDN}/firefox/firefox-ubuntu-24.04.zip

FFmpeg (playwright ffmpeg v1011)
  Install location:    ${ROOT}/ffmpeg-1011
  Download url:        ${CDN}/ffmpeg/ffmpeg-linux.zip
`,
  webkit: `WebKit 26.6 (playwright webkit v2368)
  Install location:    ${ROOT}/webkit-2368
`,
}

const MB = 1024 * 1024
const DOWNLOADS: Record<string, number> = {
  [`${CDN}/cft/chrome-linux64.zip`]: 170 * MB,
  [`${CDN}/cft/chrome-headless-shell-linux64.zip`]: 100 * MB,
  [`${CDN}/ffmpeg/ffmpeg-linux.zip`]: 2 * MB,
  [`${CDN}/firefox/firefox-ubuntu-24.04.zip`]: 95 * MB,
}

function setup(
  input: {
    files?: string[]
    platform?: NodeJS.Platform
    env?: Record<string, string>
    fail?: boolean
    home?: string
    disk?: Record<string, number>
  } = {},
) {
  const files = new Set(input.files ?? [])
  const calls: string[][] = []
  const heads: string[] = []
  const gate = { hold: undefined as Promise<void> | undefined, fail: input.fail ?? false, offline: false }
  const slash = (file: string) => file.replaceAll("\\", "/")
  const installer = new BrowserInstaller({
    platform: input.platform ?? "linux",
    env: input.env ?? {},
    // The usual directory differs from the looked-up one unless a test points both at the same place.
    home: input.home ?? "/home/kilo",
    exists: (file) => {
      const name = slash(file)
      return files.has(name) || [...files].some((item) => item.startsWith(`${name}/`))
    },
    head: async (url) => {
      heads.push(url)
      if (gate.offline) throw new Error("offline")
      return DOWNLOADS[url]
    },
    measure: async (dir) => input.disk?.[slash(dir)] ?? 0,
    run: async (args, _timeout, output) => {
      calls.push(args)
      if (gate.fail) throw new Error("npx is not available")
      const browser = args.at(-1) ?? ""
      if (args.includes("--dry-run")) return DRY[browser] ?? ""
      output?.(`Downloading Firefox 156.0 (playwright firefox v1553) from ${CDN}/firefox.zip\n|■■■■    |  10% of 95.`)
      await gate.hold
      output?.("3 MiB\n|■■■■■■■■| 100% of 95.3 MiB\n")
      output?.(`Firefox 156.0 (playwright firefox v1553) downloaded to ${ROOT}/firefox-1553\n`)
      output?.(`Downloading FFmpeg (playwright ffmpeg v1011) from ${CDN}/ffmpeg.zip\n`)
      for (const item of artifacts(DRY[browser] ?? "")) files.add(`${item.dir}/INSTALLATION_COMPLETE`)
      return ""
    },
  })
  return { installer, calls, heads, gate, files }
}

describe("Playwright installer output", () => {
  it("reads the downloads of a build with their directories and urls", () => {
    expect(artifacts(DRY.chromium)).toEqual([
      { name: "chromium", dir: `${ROOT}/chromium-1247`, url: `${CDN}/cft/chrome-linux64.zip` },
      { name: "ffmpeg", dir: `${ROOT}/ffmpeg-1011`, url: `${CDN}/ffmpeg/ffmpeg-linux.zip` },
      {
        name: "chromium-headless-shell",
        dir: `${ROOT}/chromium_headless_shell-1247`,
        url: `${CDN}/cft/chrome-headless-shell-linux64.zip`,
      },
    ])
    expect(artifacts(DRY.webkit)).toEqual([{ name: "webkit", dir: `${ROOT}/webkit-2368`, url: undefined }])
    expect(artifacts(DRY.firefox.replaceAll("\n", "\r\n")).map((item) => item.dir)).toEqual([
      `${ROOT}/firefox-1553`,
      `${ROOT}/ffmpeg-1011`,
    ])
    // Only https downloads are ever requested.
    expect(artifacts(DRY.webkit + "  Download url:        http://example.com/webkit.zip\n").at(0)?.url).toBeUndefined()
    expect(artifacts("unexpected output")).toEqual([])
  })

  it("follows each file of an install through its download", () => {
    const start = { percent: 0, total: 2 }
    const first = advance(
      start,
      `Downloading Chrome for Testing 155.0.8059.12 (playwright chromium v1247) from ${CDN}/a.zip`,
    )
    expect(first).toEqual({ name: "Chrome for Testing 155.0.8059.12", step: 1, total: 2, percent: 0 })
    const half = advance(first, "|■■■■■■■■■■■■■■■■■■■■                    |  50% of 170.2 MiB")
    expect(half).toEqual({ ...first, percent: 50, bytes: Math.round(170.2 * MB) })
    // A repeated or unrelated line changes nothing.
    expect(advance(half, "|■■■■■■■■■■■■■■■■■■■■                    |  50% of 170.2 MiB")).toBe(half)
    expect(advance(half, `Chrome for Testing 155.0.8059.12 (playwright chromium v1247) downloaded to ${ROOT}/x`)).toBe(
      half,
    )
    const done = advance(half, "|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■| 100% of 170.2 MiB")
    expect(done.percent).toBe(100)
    // The next file starts from zero and counts as the next step.
    expect(
      advance(
        done,
        `Downloading Chrome Headless Shell 155.0.8059.12 (playwright chromium-headless-shell v1247) from ${CDN}/b.zip`,
      ),
    ).toEqual({
      name: "Chrome Headless Shell 155.0.8059.12",
      step: 2,
      total: 2,
      percent: 0,
    })
  })

  it("reduces a failure to the line that names the cause", () => {
    expect(
      reason(
        [
          "Downloading Firefox 156.0 (playwright firefox v1553)",
          "Error: getaddrinfo ENOTFOUND cdn.playwright.dev",
          "    at GetAddrInfoReqWrap.onlookup (node:dns:120:26)",
        ].join("\n"),
      ),
    ).toBe("getaddrinfo ENOTFOUND cdn.playwright.dev")
    expect(reason("Failed to install browsers\nsome detail")).toBe("Failed to install browsers")
    expect(reason("something went wrong\r\n\r\n")).toBe("something went wrong")
    expect(
      reason("'npx' is not recognized as an internal or external command,\noperable program or batch file."),
    ).toContain("Install Node.js")
    expect(reason("spawn npx ENOENT")).toContain("Install Node.js")
    expect(reason("/bin/sh: 1: npx: not found")).toContain("Install Node.js")
    // A failed download that only mentions npx in Playwright's notice is not a missing npx.
    expect(
      reason(
        [
          "╔══════════════════════════════════╗",
          "║ WARNING: It looks like you are running 'npx playwright install' ║",
          "╚══════════════════════════════════╝",
          "Error: Download failed: server returned code 404. URL not found",
        ].join("\n"),
      ),
    ).toBe("Download failed: server returned code 404. URL not found")
    expect(reason("║ a notice ║\nthe download stopped\n╚═══╝")).toBe("the download stopped")
  })
})

describe("BrowserInstaller status", () => {
  it("reports installed and missing browsers", async () => {
    const ctx = setup({ files: ["/opt/google/chrome/chrome", `${ROOT}/webkit-2368/INSTALLATION_COMPLETE`] })
    expect(await ctx.installer.status()).toEqual({
      chrome: "installed",
      chromium: "missing",
      msedge: "missing",
      firefox: "missing",
      webkit: "installed",
    })
    // Each build is looked up once.
    await ctx.installer.status()
    expect(ctx.calls.map((args) => args.join(" ")).sort()).toEqual([
      "install --dry-run chromium",
      "install --dry-run firefox",
      "install --dry-run webkit",
    ])
  })

  it("finds a build in its usual directory without the lookup", async () => {
    const linux = setup({ files: ["/home/kilo/.cache/ms-playwright/webkit-2368/INSTALLATION_COMPLETE"] })
    expect(await linux.installer.known()).toEqual({ chrome: "missing", msedge: "missing", webkit: "installed" })
    expect(await linux.installer.check("webkit")).toBe("installed")
    expect(linux.calls).toEqual([])

    const win = setup({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\kilo\\AppData\\Local" },
      files: ["C:/Users/kilo/AppData/Local/ms-playwright/firefox-1553/INSTALLATION_COMPLETE"],
    })
    expect(await win.installer.known()).toMatchObject({ firefox: "installed" })

    const mac = setup({
      platform: "darwin",
      home: "/Users/kilo",
      files: ["/Users/kilo/Library/Caches/ms-playwright/chromium-1247/INSTALLATION_COMPLETE"],
    })
    expect(await mac.installer.known()).toMatchObject({ chromium: "installed" })

    const custom = setup({
      env: { PLAYWRIGHT_BROWSERS_PATH: "/opt/browsers" },
      files: ["/opt/browsers/firefox-1553/INSTALLATION_COMPLETE"],
    })
    expect(await custom.installer.known()).toMatchObject({ firefox: "installed" })
    expect([...win.calls, ...mac.calls, ...custom.calls]).toEqual([])
  })

  it("does not count a partly unpacked build as installed", async () => {
    const ctx = setup({ files: [`${ROOT}/firefox-1553/firefox`] })
    expect(await ctx.installer.check("firefox")).toBe("missing")
  })

  it("finds Chrome and Edge in the Windows and macOS install locations", async () => {
    const win = setup({
      platform: "win32",
      env: { PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)" },
      files: ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"],
    })
    expect(await win.installer.check("msedge")).toBe("installed")
    expect(await win.installer.check("chrome")).toBe("missing")
    const mac = setup({
      platform: "darwin",
      files: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    })
    expect(await mac.installer.check("chrome")).toBe("installed")
    expect(await mac.installer.check("msedge")).toBe("missing")
    expect(win.calls).toEqual([])
  })

  it("reports unknown when the Playwright CLI cannot run, and retries later", async () => {
    const ctx = setup({ fail: true, files: ["/opt/microsoft/msedge/msedge"] })
    expect(await ctx.installer.status()).toMatchObject({ msedge: "installed", firefox: "unknown", webkit: "unknown" })
    expect(await ctx.installer.sizes()).toEqual({ chromium: {}, firefox: {}, webkit: {} })
    ctx.gate.fail = false
    expect(await ctx.installer.check("firefox")).toBe("missing")
  })
})

describe("BrowserInstaller sizes", () => {
  it("reports the download of a missing build and the disk use of an installed one", async () => {
    const ctx = setup({
      files: [`${ROOT}/firefox-1553/INSTALLATION_COMPLETE`, `${ROOT}/ffmpeg-1011/INSTALLATION_COMPLETE`],
      disk: { [`${ROOT}/firefox-1553`]: 290 * MB, [`${ROOT}/ffmpeg-1011`]: 5 * MB },
    })
    expect(await ctx.installer.sizes()).toEqual({
      // The installed ffmpeg helper is not downloaded again.
      chromium: { download: 270 * MB },
      // Shared helpers do not count as the browser's own disk use.
      firefox: { disk: 290 * MB },
      // The server reports no size for this download.
      webkit: {},
    })
    await ctx.installer.sizes()
    expect(ctx.heads.sort()).toEqual([`${CDN}/cft/chrome-headless-shell-linux64.zip`, `${CDN}/cft/chrome-linux64.zip`])
  })

  it("counts every file a fresh install downloads", async () => {
    const ctx = setup()
    expect((await ctx.installer.sizes()).chromium).toEqual({ download: 272 * MB })
    expect((await ctx.installer.sizes()).firefox).toEqual({ download: 97 * MB })
  })

  it("leaves the size out when the server cannot be reached, and asks again later", async () => {
    const ctx = setup()
    ctx.gate.offline = true
    expect((await ctx.installer.sizes()).firefox).toEqual({})
    ctx.gate.offline = false
    expect((await ctx.installer.sizes()).firefox).toEqual({ download: 97 * MB })
  })

  it("measures the headless shell together with Chromium", async () => {
    const ctx = setup({
      files: [
        "/home/kilo/.cache/ms-playwright/chromium-1247/INSTALLATION_COMPLETE",
        "/home/kilo/.cache/ms-playwright/chromium_headless_shell-1247/INSTALLATION_COMPLETE",
      ],
      disk: {
        "/home/kilo/.cache/ms-playwright/chromium-1247": 400 * MB,
        "/home/kilo/.cache/ms-playwright/chromium_headless_shell-1247": 250 * MB,
      },
    })
    expect((await ctx.installer.sizes()).chromium).toEqual({ disk: 650 * MB })
  })
})

describe("BrowserInstaller install", () => {
  // Let the install read its lookup and the first output chunk.
  const settle = async () => {
    for (const _ of Array.from({ length: 20 })) await Promise.resolve()
  }

  it("installs a build once for concurrent requests and reports each file as it goes", async () => {
    const ctx = setup()
    const hold = Promise.withResolvers<void>()
    ctx.gate.hold = hold.promise
    const seen: unknown[] = []
    const calls = { second: 0 }
    const first = ctx.installer.install("firefox", () => seen.push(ctx.installer.progress().firefox))
    const second = ctx.installer.install("firefox", () => calls.second++)
    expect(ctx.installer.installing()).toEqual(["firefox"])
    await settle()
    // Firefox and the ffmpeg helper are both missing, so the install has two files.
    expect(ctx.installer.progress()).toEqual({ firefox: { name: "Firefox 156.0", step: 1, total: 2, percent: 0 } })
    hold.resolve()
    await Promise.all([first, second])
    expect(seen).toEqual([
      { percent: 0, total: 2 },
      { name: "Firefox 156.0", step: 1, total: 2, percent: 0 },
      // This line arrived split over two chunks.
      { name: "Firefox 156.0", step: 1, total: 2, percent: 10, bytes: Math.round(95.3 * MB) },
      { name: "Firefox 156.0", step: 1, total: 2, percent: 100, bytes: Math.round(95.3 * MB) },
      { name: "FFmpeg", step: 2, total: 2, percent: 0 },
    ])
    // Both requests watch the one download.
    expect(calls.second).toBe(seen.length)
    expect(ctx.installer.installing()).toEqual([])
    expect(ctx.installer.progress()).toEqual({})
    expect(ctx.calls.filter((args) => !args.includes("--dry-run"))).toEqual([["install", "firefox"]])
    expect(await ctx.installer.check("firefox")).toBe("installed")
  })

  it("does not count files that are already installed as steps", async () => {
    const ctx = setup({ files: [`${ROOT}/ffmpeg-1011/INSTALLATION_COMPLETE`] })
    const hold = Promise.withResolvers<void>()
    ctx.gate.hold = hold.promise
    const task = ctx.installer.install("firefox")
    await settle()
    expect(ctx.installer.progress().firefox).toMatchObject({ step: 1, total: 1 })
    hold.resolve()
    await task
  })

  it("refuses to install browsers that Playwright does not download and surfaces failures", async () => {
    const ctx = setup()
    await expect(ctx.installer.install("chrome")).rejects.toThrow("not a Playwright build")
    ctx.gate.fail = true
    await expect(ctx.installer.install("webkit")).rejects.toThrow("npx is not available")
    expect(ctx.installer.installing()).toEqual([])
  })
})
