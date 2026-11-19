#!/usr/bin/env bun
// Real end-to-end check of the Kilo browser bridge: the built Chrome MV3 extension loaded into a Chromium the harness
// launches itself (a real profile, no DevTools download override), paired over loopback with the real CLI
// (`kilo2 run`, `browser.backend: "extension"`), driven by a scripted OpenAI-compatible model. Not a `bun test` file:
// it needs a display, a built CLI binary and the built extension. The launch, pairing, model and CLI-run steps live in
// extension-harness.ts.
//
//   xvfb-run -a -s "-screen 0 1920x1080x24" bun test/browser/extension-e2e.ts <kilo2> <scenario>
//   xvfb-run -a -s "-screen 0 1920x1080x24" bun test/browser/extension-e2e.ts <kilo2> all [--repeat N] [--only a,b] [--out dir]
//
//   E2E_EXTENSION_DIR   the built unpacked extension (default: ../../../cloud/apps/extension/.output/chrome-mv3)
//   E2E_CHROMIUM        the Chromium executable (default: playwright-core's own build)
//   E2E_HOME            the run's scratch root (default: a fresh mkdtemp); the harness creates run-<n> under it
//   E2E_HUB_PORTS       hub ports as `<first>-<last>` (default: a free port per hub)
//   E2E_PREFERENCES     extra profile Preferences as JSON, merged at the top level before launch
//
// Scenarios: download-path, navigate-snapshot, permission, frames, sensitive, group, stop, unpaired, download,
// download-navigate, download-ungranted, download-late, download-tabs-new, download-tabs-new-notoken,
// download-approved-one, download-approved-one-multi. `all` runs every scenario in its own child process (fresh
// E2E_HOME each, one after another) and prints one summary table; it exits non-zero when any run failed.
//
// download-approved-one runs on Chrome's default settings, where the download request limiter lets one download per
// gesture through and holds the rest; download-approved-one-multi is the same scenario for a user who allowed the
// site "automatic downloads" (`profile.default_content_setting_values.automatic_downloads = 1`), so both downloads
// of one gesture reach the download manager.
//
// Each scenario prints one JSON report and exits non-zero when an expectation fails. Every CLI run gets a fresh home,
// a fresh hub and a fresh loopback pairing; two CLI runs in one scenario never overlap. Every report carries the CDP
// log of the harness's own connection (`cdp`): `cdp.downloadBehavior` must be empty, or Chrome's DevTools delegate
// owned the downloads instead of the extension's guard.
//
// The product path this exercises, in order: the extension's "Allow local agents" switch (its settings page, with the
// optional nativeMessaging prompt granted the way an accepted prompt would), `kilo2 browser hub --loopback`, the
// hub's `pairing.url` RPC over the per-user CLI socket, the pairing page opened in the browser (the extension redeems
// the token and dials the hub), then `kilo2 run` with a scripted model.
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  armDownloadProbe,
  downloadItems,
  type Bridge,
  type Call,
  cdpReport,
  chromiumExecutable,
  decodePng,
  defaultExtensionDirectory,
  enableLocalAgents,
  field,
  groupById,
  type GroupInfo,
  jsonOf,
  launchChromium,
  type Launched,
  openUserTab,
  type Page,
  pixel,
  type Plan,
  promoteDownloadsCopy,
  readDownloadProbe,
  record,
  refOf,
  type Rule,
  type RunOptions,
  runAgent,
  type Settings,
  startModel,
  tabState,
  type TabState,
  toolTimes,
  until,
} from "./extension-harness"

const binaryInput = process.argv[2]
const scenario = process.argv[3] ?? "navigate-snapshot"
if (!binaryInput) throw new Error("usage: bun test/browser/extension-e2e.ts <kilo2> <scenario|all>")
// Spawned runs use a fresh HOME as their cwd, so the binary path must not depend on the harness's cwd.
const binary = path.resolve(binaryInput)
const extensionDirectory = defaultExtensionDirectory

const MARKER = "IFRAME-MARKER"
const PUBLIC_MARKER = "PUBLIC-ORIGIN"
const PASSWORD_VALUE = "hunter2"

// ---------------------------------------------------------------------------------------------
// Fixtures: a localhost page, a cross-origin frame on 127.0.0.2, and downloads.
// ---------------------------------------------------------------------------------------------

/** Every value the fixture page reported from its password field. */
const recorded: string[] = []
/** Every download request the fixture served, so a stopped download is distinguishable from a click that never ran. */
const downloadHits: { at: number; path: string }[] = []

const simple = `<!doctype html>
<html><head><meta charset="utf-8"><title>Browser E2E</title></head>
<body>
  <h1>Browser E2E</h1>
  <button id="go">Click me</button>
  <input id="pw" type="password" aria-label="Password" />
  <p id="status">idle</p>
  <a id="file" href="/download">Get the report</a>
  <script>
    document.getElementById("go").addEventListener("click", () => {
      document.getElementById("status").textContent = "clicked"
    })
    // The fixture records what reaches the password field, so a test can prove a rejected fill never landed.
    const pw = document.getElementById("pw")
    const send = () => fetch("/__record", { method: "POST", body: pw.value })
    pw.addEventListener("input", send)
    pw.addEventListener("change", send)
  </script>
</body></html>`

const framed = (frameOrigin: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Browser E2E</title></head>
<body style="margin:0">
  <iframe src="${frameOrigin}/" style="position:fixed;left:0;top:0;width:320px;height:200px;border:0"></iframe>
  <h1 style="position:fixed;left:400px;top:0">Browser E2E</h1>
  <button id="go" style="position:fixed;left:400px;top:60px">Click me</button>
  <script>document.getElementById("go").addEventListener("click", () => { document.body.style.background = "#00ff00" })</script>
</body></html>`

const userPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>User tab</title></head>
<body><h1>USER PAGE</h1></body></html>`

const downloadPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>Download E2E</title></head>
<body>
  <h1>Download E2E</h1>
  <a id="file" href="/download">Get the report</a>
</body></html>`

const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } })
const attachment = (body: string, filename: string) =>
  new Response(body, {
    headers: { "content-disposition": `attachment; filename="${filename}"`, "content-type": "text/plain" },
  })

let localOrigin = ""
let publicOrigin = ""

function startFixtures() {
  const fixture = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/__record") {
        recorded.push(await request.text().catch(() => ""))
        return new Response(null, { status: 204 })
      }
      if (url.pathname === "/download") {
        downloadHits.push({ at: Date.now(), path: url.pathname })
        return attachment("report-body", "report.txt")
      }
      if (url.pathname === "/download-second") {
        downloadHits.push({ at: Date.now(), path: url.pathname })
        return attachment("second-body", "second.txt")
      }
      if (url.pathname === "/download-two") {
        return html(`<!doctype html><html><head><title>Two downloads</title></head><body>
          <h1>Two downloads</h1><a id="file" href="/download">Get the report</a>
          <script>
            // The approved link starts its own file; the same click also starts a second, different one.
            document.getElementById('file').addEventListener('click', () => {
              const extra = document.createElement('a')
              extra.href = '/download-second'
              extra.download = 'second.txt'
              document.body.appendChild(extra)
              extra.click()
            })
          </script>
        </body></html>`)
      }
      if (url.pathname === "/download-late") {
        // The click itself starts no download; the attachment appears about 1.5 s later (after the click's wait).
        await Bun.sleep(1500)
        downloadHits.push({ at: Date.now(), path: url.pathname })
        return attachment("report-body", "report.txt")
      }
      if (url.pathname === "/download-late-page") {
        return html(`<!doctype html><html><head><title>Late download</title></head><body>
          <h1>Late download</h1><a id="file" href="/download-late">Get the report</a>
        </body></html>`)
      }
      if (url.pathname === "/user") return html(userPage)
      if (url.pathname === "/download-page") return html(downloadPage)
      if (url.pathname === "/framed") return html(framed(publicOrigin))
      return html(simple)
    },
  })
  const frame = Bun.serve({
    hostname: "127.0.0.2",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/public") {
        return html(`<!doctype html><html><head><title>Public</title></head><body><h1 id="marker">${PUBLIC_MARKER}</h1></body></html>`)
      }
      return html(`<!doctype html><html><head><title>Frame</title></head>
<body style="margin:0;background:#ff0000"><h1 id="marker">${MARKER}</h1></body></html>`)
    },
  })
  localOrigin = fixture.url.origin
  publicOrigin = frame.url.origin
  return () => {
    fixture.stop(true)
    frame.stop(true)
  }
}

// ---------------------------------------------------------------------------------------------
// Per-process state: one browser, one model, one side panel.
// ---------------------------------------------------------------------------------------------

const failures: string[] = []
function expect(condition: boolean, message: string) {
  if (!condition) failures.push(message)
}

let launched: Launched | undefined
let bridge: Bridge
let panel: Page

const browserOf = () => {
  if (launched === undefined) throw new Error("the browser is not running")
  return launched
}
const run = async (plan: Plan, settings: Settings, options: RunOptions = {}) => {
  const result = await runAgent(bridge, plan, settings, options)
  expect(result.planErrors.length === 0, `the scenario's plan threw, so the run ended early: ${result.planErrors.join("; ")}`)
  return result
}
const tabs = () => tabState(browserOf().worker)

function report(results: Record<string, unknown>) {
  return {
    cdp: launched === undefined ? undefined : cdpReport(launched.cdp),
    chromium: chromiumExecutable,
    extension: extensionDirectory,
    extensionId: launched?.extensionId ?? "",
    failures,
    scenario,
    serviceWorker: launched?.swLog.lines.slice(-120) ?? [],
    ...(failures.length && launched ? { chromiumLog: launched.chromiumLog.text.slice(-3_000) } : {}),
    ...results,
  }
}

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------

/**
 * The launch itself: a plain user download (no agent, switch off) must go through Chrome's own download manager, so
 * `chrome.downloads.onDeterminingFilename` fires in the extension's service worker and the file lands under its real
 * name in the profile's `download.default_directory`. Under a DevTools download override neither happens.
 */
async function downloadPath() {
  const { browser, worker } = browserOf()
  await armDownloadProbe(worker)
  await clearDownloads()
  const url = `${localOrigin}/download`
  const cdp = await browser.newBrowserCDPSession()
  await cdp.send("Target.createTarget", { newWindow: false, url })
  const files = await until(
    async () => ((await downloadFiles()).includes("report.txt") ? await downloadFiles() : undefined),
    15_000,
    "report.txt lands in the download directory",
  ).catch(async () => downloadFiles())
  const events = await until(
    async () => {
      const seen = await readDownloadProbe(worker)
      return seen.some((event) => event.event === "determining") ? seen : undefined
    },
    5_000,
    "onDeterminingFilename fires",
  ).catch(async () => readDownloadProbe(worker))
  const determining = events.filter((event) => event.event === "determining")
  const bodies = await downloadBodies()
  expect(determining.length === 1, `onDeterminingFilename fired ${determining.length} times: ${JSON.stringify(events)}`)
  expect(
    determining.some((event) => event.filename === "report.txt" && event.url === url),
    `onDeterminingFilename did not see report.txt from ${url}: ${JSON.stringify(events)}`,
  )
  expect(JSON.stringify(files) === JSON.stringify(["report.txt"]), `the download directory holds ${JSON.stringify(files)}`)
  expect(bodies.includes("report-body"), `the saved file has no body: ${JSON.stringify(bodies)}`)
  return { downloads: downloadsPath, events, files }
}

async function navigateSnapshot() {
  const plan: Plan = (step) => {
    if (step.results.length === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      const ref = refOf(step.results[1] ?? "", /button "Click me" \[ref=([^\]]+)\]/)
      return ref ? { args: { element: "the Click me button", target: ref }, name: "browser_click" } : undefined
    }
    if (step.results.length === 3) return { args: {}, name: "browser_snapshot" }
    return undefined
  }
  const result = await run(plan, {})
  const results = result.last.results
  const snapshot = results[1] ?? ""
  const clicked = results[2] ?? ""
  const after = results[3] ?? ""
  expect(snapshot.includes('button "Click me"'), `the snapshot has no button:\n${snapshot.slice(0, 500)}`)
  expect(
    clicked.includes("clicked") || after.includes("clicked"),
    `the click did not change the page:\n${clicked.slice(0, 500)}\n---\n${after.slice(0, 500)}`,
  )
  expect(result.code === 0, `run exited ${result.code}\n${result.stderr.slice(-1_500)}`)
  return {
    hubLog: result.hub.log.text.slice(-2_000),
    results: results.map((value) => value.slice(0, 500)),
    run: { code: result.code, stderr: result.stderr.slice(-2_000), stdout: result.stdout.slice(-6_000) },
  }
}

async function permission() {
  // 127.0.0.2 is not the localhost family, so the default rules ask for it.
  const refused = await run(
    (step) => (step.results.length === 0 ? { args: { url: `${publicOrigin}/public` }, name: "browser_navigate" } : undefined),
    { strict: true },
  )
  const refusedResult = refused.last.results[0] ?? ""
  expect(
    refusedResult.includes("cannot ask the user for permission") || refusedResult.includes("Permission denied"),
    `a non-localhost navigation was not refused:\n${refusedResult.slice(0, 500)}`,
  )
  expect(!refusedResult.includes(PUBLIC_MARKER), `the refused navigation leaked the page:\n${refusedResult.slice(0, 500)}`)

  const rules: Rule[] = [
    { action: "browser", effect: "allow", resource: `navigate:${publicOrigin}` },
    { action: "browser", effect: "allow", resource: `read:${publicOrigin}` },
  ]
  const allowed = await run((step) => {
    if (step.results.length === 0) return { args: { url: `${publicOrigin}/public` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    return undefined
  }, { rules, strict: true })
  const navigated = allowed.last.results[0] ?? ""
  const snapshot = allowed.last.results[1] ?? ""
  expect(navigated.includes(publicOrigin), `the allowed navigation did not report the URL:\n${navigated.slice(0, 500)}`)
  expect(snapshot.includes(PUBLIC_MARKER), `the granted page's content is missing:\n${snapshot.slice(0, 500)}`)
  return {
    allowed: { snapshot: snapshot.slice(0, 500), stdout: allowed.stdout.slice(-1_000) },
    hubLogs: [refused.hub.log.text.slice(-1_000), allowed.hub.log.text.slice(-1_000)],
    refused: refusedResult.slice(0, 500),
  }
}

async function frames() {
  const { context } = browserOf()
  const dpr = Number(process.env.E2E_DPR ?? process.env.E2E_DSF ?? "1")
  const userPage = await context.newPage()
  await userPage.goto(`${localOrigin}/user`)
  const dprUser = await userPage.evaluate(() => window.devicePixelRatio)
  const buttonRef = (snapshot: string) => refOf(snapshot, /button "Click me" \[ref=([^\]]+)\]/)
  const withheld = await run((step) => {
    if (step.results.length === 0) return { args: { url: `${localOrigin}/framed` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      const ref = buttonRef(step.results[1] ?? "")
      return ref ? { args: { element: "the Click me button", target: ref }, name: "browser_click" } : undefined
    }
    // Both screenshots follow the click: the mask must land on the right pixels in each scale.
    if (step.results.length === 3) return { args: { scale: "css", type: "png" }, name: "browser_take_screenshot" }
    if (step.results.length === 4) return { args: { scale: "device", type: "png" }, name: "browser_take_screenshot" }
    return undefined
  }, {})
  const snapshot = withheld.last.results[1] ?? ""
  const clicked = withheld.last.results[2] ?? ""
  const agentPage = context.pages().find((page) => page.url().includes("/framed"))
  const dprAgent = agentPage === undefined ? undefined : await agentPage.evaluate(() => window.devicePixelRatio)
  const css = agentPage === undefined ? undefined : await agentPage.evaluate(() => ({ height: window.innerHeight, width: window.innerWidth }))
  const cssImage = decodePng(withheld.pngs[0] ?? withheld.last.images[0])
  const deviceImage = decodePng(withheld.pngs[1] ?? withheld.last.images[1])
  const maskedCss = pixel(cssImage, 160, 100)
  const maskedDevice = pixel(deviceImage, 160 * dpr, 100 * dpr)
  const outsideCss = pixel(cssImage, 340, 100)
  const outsideDevice = pixel(deviceImage, 340 * dpr, 100 * dpr)
  expect(dprUser === dpr, `the user page reports devicePixelRatio ${String(dprUser)}, expected ${dpr}`)
  expect(dprAgent === dpr, `the agent tab reports devicePixelRatio ${String(dprAgent)}, expected ${dpr}`)
  expect(
    cssImage?.width === Math.round(css?.width ?? 1280),
    `the css screenshot is ${String(cssImage?.width)} px wide, expected the CSS viewport ${String(css?.width)}`,
  )
  expect(
    deviceImage?.width === Math.round((css?.width ?? 1280) * dpr),
    `the device screenshot is ${String(deviceImage?.width)} px wide, expected ${Math.round((css?.width ?? 1280) * dpr)}`,
  )
  expect(
    snapshot.includes(`[origin withheld: ${publicOrigin}]`),
    `the snapshot did not withhold the frame:\n${snapshot.slice(0, 600)}`,
  )
  expect(!snapshot.includes(MARKER), `the withheld frame's marker reached the snapshot:\n${snapshot.slice(0, 600)}`)
  expect(clicked.length > 0, "the click before the framed screenshot did not run")
  expect(
    maskedCss !== undefined && maskedCss.every((value) => value < 40) && maskedDevice !== undefined && maskedDevice.every((value) => value < 40),
    `the iframe center after the click is not masked in both scales: css=${JSON.stringify(maskedCss)} device=${JSON.stringify(maskedDevice)}`,
  )
  expect(
    outsideCss !== undefined && outsideCss.some((value) => value > 60) && outsideDevice !== undefined && outsideDevice.some((value) => value > 60),
    `the pixel just outside the iframe is black in a scale: css=${JSON.stringify(outsideCss)} device=${JSON.stringify(outsideDevice)}`,
  )

  const rules: Rule[] = [{ action: "browser", effect: "allow", resource: `read:${publicOrigin}` }]
  const allowed = await run((step) => {
    if (step.results.length === 0) return { args: { url: `${localOrigin}/framed` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      // The withheld iframe carries a ref now; targeting it asks for read:<frame origin>.
      const ref = refOf(step.results[1] ?? "", /iframe \[ref=([^\]]+)\]/)
      return ref ? { args: { target: ref }, name: "browser_snapshot" } : undefined
    }
    if (step.results.length === 3) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 4) {
      const ref = buttonRef(step.results[3] ?? "")
      return ref ? { args: { element: "the Click me button", target: ref }, name: "browser_click" } : undefined
    }
    if (step.results.length === 5) return { args: { scale: "css", type: "png" }, name: "browser_take_screenshot" }
    if (step.results.length === 6) return { args: { scale: "device", type: "png" }, name: "browser_take_screenshot" }
    return undefined
  }, { rules })
  const granted = allowed.last.results[3] ?? ""
  const grantedClick = allowed.last.results[4] ?? ""
  const grantedCss = decodePng(allowed.pngs[0] ?? allowed.last.images[0])
  const grantedDevice = decodePng(allowed.pngs[1] ?? allowed.last.images[1])
  const revealedCss = pixel(grantedCss, 160, 100)
  const revealedDevice = pixel(grantedDevice, 160 * dpr, 100 * dpr)
  const grantedOutsideCss = pixel(grantedCss, 340, 100)
  const grantedOutsideDevice = pixel(grantedDevice, 340 * dpr, 100 * dpr)
  expect(granted.includes(MARKER), `the granted frame's marker is missing:\n${granted.slice(0, 600)}`)
  expect(grantedClick.length > 0, "the click before the granted screenshot did not run")
  expect(
    revealedCss !== undefined && revealedCss[0] > 200 && revealedCss[1] < 80 && revealedCss[2] < 80 &&
      revealedDevice !== undefined && revealedDevice[0] > 200 && revealedDevice[1] < 80 && revealedDevice[2] < 80,
    `the granted frame is not visible in the screenshot after the click: css=${JSON.stringify(revealedCss)} device=${JSON.stringify(revealedDevice)}`,
  )
  expect(
    grantedOutsideCss !== undefined && grantedOutsideCss.some((value) => value > 60) &&
      grantedOutsideDevice !== undefined && grantedOutsideDevice.some((value) => value > 60),
    `the pixel just outside the iframe is black in the granted run: css=${JSON.stringify(grantedOutsideCss)} device=${JSON.stringify(grantedOutsideDevice)}`,
  )
  return {
    granted: granted.slice(0, 600),
    hubLogs: [withheld.hub.log.text.slice(-1_000), allowed.hub.log.text.slice(-1_000)],
    css,
    dprAgent,
    dprUser,
    maskedCss,
    maskedDevice,
    revealedCss,
    revealedDevice,
    results: withheld.last.results.map((value) => value.slice(0, 700)),
    screenshot: {
      css: { height: cssImage?.height, width: cssImage?.width },
      device: { height: deviceImage?.height, width: deviceImage?.width },
    },
    snapshot: snapshot.slice(0, 600),
  }
}

async function sensitive() {
  recorded.length = 0
  const basePlan: Plan = (step) => {
    if (step.results.length === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      const ref = refOf(step.results[1] ?? "", /button "Click me" \[ref=([^\]]+)\]/)
      // The click establishes the act grant, so the type's own call is where the sensitive step is classified.
      return ref ? { args: { element: "the Click me button", target: ref }, name: "browser_click" } : undefined
    }
    if (step.results.length === 3) {
      const ref = refOf(step.results[1] ?? "", /textbox "Password" \[ref=([^\]]+)\]/)
      return ref ? { args: { element: "the password field", target: ref, text: PASSWORD_VALUE }, name: "browser_type" } : undefined
    }
    return undefined
  }

  const refused = await run(basePlan, {})
  const typed = refused.last.results[3] ?? ""
  expect(
    typed.includes("cannot ask the user for permission") || typed.includes("Permission denied"),
    `the password fill was not refused:\n${typed.slice(0, 500)}`,
  )
  expect(!recorded.includes(PASSWORD_VALUE), `the fixture recorded the rejected fill: ${JSON.stringify(recorded)}`)

  recorded.length = 0
  const allowed = await run(basePlan, { allowSensitive: true })
  await until(() => (recorded.includes(PASSWORD_VALUE) ? true : undefined), 5_000, "the fixture records the allowed fill")
  expect(recorded.includes(PASSWORD_VALUE), `the fixture did not record the allowed fill: ${JSON.stringify(recorded)}`)
  return {
    allowed: (allowed.last.results[3] ?? "").slice(0, 400),
    hubLogs: [refused.hub.log.text.slice(-1_000), allowed.hub.log.text.slice(-1_000)],
    recorded: [...recorded],
    refused: typed.slice(0, 500),
  }
}

async function group() {
  const userUrl = `${localOrigin}/user`
  const userTabId = await openUserTab(browserOf(), userUrl)
  const userBefore = (await tabs()).tabs.find((tab) => tab.id === userTabId)
  let during: TabState | undefined
  let listed: string | undefined

  const result = await run((step) => {
    if (step.results.length === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      listed = step.results[2]
      return { args: { action: "list" }, name: "browser_tabs" }
    }
    if (step.results.length === 3) {
      listed = step.results[2]
      return (async () => {
        during = await tabs()
        const parsed = jsonOf(step.results[2] ?? "")
        const listedTabs = field(parsed, "tabs")
        const user = Array.isArray(listedTabs) ? listedTabs.find((tab) => field(tab, "url") === userUrl) : undefined
        const withheld = Array.isArray(listedTabs) ? listedTabs.find((tab) => field(tab, "url") === "[origin withheld]") : undefined
        const index = field(user ?? withheld, "index")
        return typeof index === "number" ? { args: { action: "select", index }, name: "browser_tabs" } : undefined
      })()
    }
    return undefined
  }, {})
  during ??= await tabs()

  const after = await tabs()
  const userAfter = after.tabs.find((tab) => tab.id === userTabId)
  const userDuring = during.tabs.find((tab) => tab.id === userTabId)
  const kiloGroup = during.groups.find(
    (candidate) =>
      typeof candidate.title === "string" &&
      candidate.title.startsWith("Kilo · ") &&
      candidate.title !== "Kilo · ended" &&
      candidate.collapsed !== true,
  )
  const agentTab = during.tabs.find((tab) => kiloGroup !== undefined && tab.groupId === kiloGroup.id)
  const refused = result.last.results[3] ?? ""

  expect(userBefore?.groupId === -1, `the user tab was already grouped: ${JSON.stringify(userBefore)}`)
  expect(userAfter !== undefined, "the user tab disappeared")
  expect(userDuring?.groupId === -1, `the user tab entered the agent's group: ${JSON.stringify(userDuring)}`)
  expect(userAfter?.groupId === -1, `the user tab entered the agent's group: ${JSON.stringify(userAfter)}`)
  expect(userAfter?.url === userUrl, `the user tab was navigated: ${JSON.stringify(userAfter)}`)
  expect(kiloGroup !== undefined, `no live "Kilo · …" tab group: ${JSON.stringify(during.groups)}`)
  expect(agentTab !== undefined, `the agent has no tab in its group: ${JSON.stringify(during.tabs)}`)
  expect(agentTab?.id !== userTabId, "the agent's tab is the user's tab")
  expect(
    refused.includes("not in the agent session"),
    `selecting the user's tab was not refused:\n${refused.slice(0, 500)}`,
  )
  return {
    agentTab: agentTab?.id,
    group: kiloGroup,
    hubLog: result.hub.log.text.slice(-1_500),
    listed: (listed ?? "").slice(0, 800),
    refused: refused.slice(0, 400),
    tabs: during.tabs.map((tab) => ({ active: tab.active, groupId: tab.groupId, id: tab.id, url: tab.url })),
    userTabId,
  }
}

async function stop() {
  const { worker } = browserOf()
  let stopError: unknown
  let liveGroupId: number | undefined
  let endedGroup: GroupInfo | undefined
  const stopAll = async () => {
    try {
      const live = await until(
        async () => (await tabs()).groups.find((candidate) => typeof candidate.title === "string" && candidate.title.startsWith("Kilo · ")),
        20_000,
        "the live Kilo group",
      )
      liveGroupId = live.id
      const button = panel.getByRole("button", { name: "Stop all" })
      await button.waitFor({ timeout: 20_000 })
      await button.click()
      endedGroup = await until(async () => {
        if (liveGroupId === undefined) return undefined
        const ended = await groupById(worker, liveGroupId)
        return ended.title === "Kilo · ended" && ended.collapsed === true && ended.color === "grey" ? ended : undefined
      }, 20_000, "the group turns ended")
    } catch (error) {
      stopError = error
    }
  }

  const result = await run(
    (step) => {
      if (step.results.length === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
      if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
      if (step.results.length === 2) {
        // Stop all while the CLI waits for the model's next step; the next call is the one after the stop.
        return (async () => {
          await stopAll()
          const afterStop: Call = { args: { url: `${localOrigin}/?after-stop=1` }, name: "browser_navigate" }
          return afterStop
        })()
      }
      return undefined
    },
    {},
  )

  const next = result.last.results[2] ?? ""
  const state = await tabs()
  expect(stopError === undefined, `Stop all did not run: ${String(stopError)}`)
  expect(endedGroup !== undefined, `no "Kilo · ended" group: ${JSON.stringify(state.groups)}`)
  expect(next.includes("The user stopped this browser session"), `the next call was not user_stopped:\n${next.slice(0, 600)}`)
  return {
    ended: endedGroup,
    groups: state.groups,
    hubLog: result.hub.log.text.slice(-1_500),
    liveGroupId,
    next: next.slice(0, 600),
  }
}

async function unpaired() {
  // The extension is loaded but its switch is off: nothing dials the hub the CLI finds for itself.
  const result = await run(
    (step) => (step.results.length === 0 ? { args: { url: localOrigin }, name: "browser_navigate" } : undefined),
    {},
    { pair: false },
  )
  const reply = result.last.results[0] ?? ""
  const output = `${result.stdout}\n${result.stderr}`
  const hint = "Install the Kilo browser extension and turn on"
  expect(reply.includes("The browser is not available right now"), `the CLI did not get browser_unavailable:\n${reply.slice(0, 500)}`)
  // #16305 puts the setup step into the model-visible text, not only the tool metadata (a non-interactive run has no toast).
  expect(reply.includes(hint), `the setup step is not model-visible:\n${reply.slice(0, 800)}`)
  expect(output.includes(hint), `the setup step is missing from the CLI output:\n${output.slice(-2_000)}`)
  return {
    hubLog: result.hub.log.text.slice(-1_500),
    reply: reply.slice(0, 400),
    run: { code: result.code, stderr: result.stderr.slice(-1_500) },
  }
}

let downloadsPath: string | undefined

/**
 * Finished files in the download directory. Chrome writes in-flight bytes to `.crdownload` and, during an
 * onDeterminingFilename hold, to a hidden `.com.google.Chrome.*` temp file; neither is a saved file.
 */
async function downloadFiles(): Promise<string[]> {
  if (downloadsPath === undefined) return []
  return (await fs.readdir(downloadsPath).catch(() => [] as string[]))
    .filter((file) => !file.endsWith(".crdownload") && !file.startsWith(".com.google.Chrome."))
    .sort()
}

async function downloadBodies(): Promise<string[]> {
  const directory = downloadsPath
  if (directory === undefined) return []
  return Promise.all((await downloadFiles()).map((file) => fs.readFile(path.join(directory, file), "utf8").catch(() => "")))
}

async function clearDownloads() {
  const directory = downloadsPath
  if (directory === undefined) return
  for (const file of await fs.readdir(directory).catch(() => [] as string[])) {
    await fs.rm(path.join(directory, file), { force: true, recursive: true }).catch(() => undefined)
  }
}

const APPROVAL = "Approved. Repeat the same step"

/**
 * A click on an attachment link: the first call cancels the download and reports a post-action need (auto-approved by
 * `allow_sensitive`), the identical repeat spends the step token and keeps exactly one file, and a third identical call
 * is guarded again. The folder is read after every call, not polled.
 */
async function download() {
  const linkRef = (snapshot: string) => refOf(snapshot, /link "Get the report" \[ref=([^\]]+)\]/)
  const folder: string[][] = []
  const plan: Plan = async (step) => {
    folder.push(await downloadFiles())
    if (step.results.length === 0) return { args: { url: `${localOrigin}/download-page` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length >= 2 && step.results.length <= 4) {
      // The repeat's file is written asynchronously; let it land before the third call arms the guard again.
      if (step.results.length === 4) await until(async () => ((await downloadFiles()).length === 1 ? true : undefined), 10_000, "the repeat's file lands")
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { args: { element: "the report link", target: ref }, name: "browser_click" } : undefined
    }
    return undefined
  }

  await clearDownloads()
  const hitsBefore = downloadHits.length
  const result = await run(plan, { allowSensitive: true })
  const text = result.last.results
  const hits = downloadHits.length - hitsBefore
  // The guarded call is event index 2 (navigate, snapshot, click); the repeat must follow it in under 200 ms.
  const events = toolTimes(result.stdout)
  const repeatGapMs = events[3] === undefined || events[2] === undefined ? undefined : Math.round(events[3].start - events[2].end)
  expect(repeatGapMs !== undefined && repeatGapMs < 200, `the repeat was not immediate: ${String(repeatGapMs)} ms`)
  expect(text[2]?.includes(APPROVAL), `the guarded click did not report the approval:\n${(text[2] ?? "").slice(0, 600)}`)
  expect((folder[3] ?? []).length === 0, `the stopped download created a file: ${JSON.stringify(folder[3])}`)
  expect(!(text[3] ?? "").includes("permission"), `the repeat was refused:\n${(text[3] ?? "").slice(0, 600)}`)
  expect((folder[4] ?? []).length === 1, `the repeat did not save exactly one file: ${JSON.stringify(folder[4])}`)
  expect(text[4]?.includes(APPROVAL), `the third call was not guarded again:\n${(text[4] ?? "").slice(0, 600)}`)
  expect((folder[5] ?? []).length === 1, `the third call changed the folder: ${JSON.stringify(folder[5])}`)
  expect(hits === 3, `the click reached the fixture ${hits} times instead of three`)
  const bodies = await downloadBodies()
  expect(bodies.some((body) => body.includes("report-body")), `the kept file has no body: ${JSON.stringify(bodies)}`)
  return {
    folder,
    hits,
    repeatGapMs,
    results: text.map((value) => value.slice(0, 400)),
    texts: text.slice(2, 5).map((value) => value.slice(0, 300)),
  }
}

/** Navigating straight to an attachment URL: the same guarded, approved-repeat and re-guarded sequence. */
async function downloadNavigate() {
  const userUrl = `${localOrigin}/user`
  const userTabId = await openUserTab(browserOf(), userUrl)
  const userBefore = (await tabs()).tabs.find((tab) => tab.id === userTabId)
  let during: TabState | undefined
  const folder: string[][] = []
  const plan: Plan = async (step) => {
    folder.push(await downloadFiles())
    if (step.results.length === 2) during = await tabs()
    if (step.results.length <= 2) return { args: { url: `${localOrigin}/download` }, name: "browser_navigate" }
    return undefined
  }

  await clearDownloads()
  const hitsBefore = downloadHits.length
  const result = await run(plan, { allowSensitive: true })
  const text = result.last.results
  const hits = downloadHits.length - hitsBefore
  const after = await tabs()
  const userDuring = during?.tabs.find((tab) => tab.id === userTabId)
  const userAfter = after.tabs.find((tab) => tab.id === userTabId)
  expect(text[0]?.includes(APPROVAL), `the guarded navigation did not report the approval:\n${(text[0] ?? "").slice(0, 600)}`)
  expect((folder[1] ?? []).length === 0, `the guarded navigation created a file: ${JSON.stringify(folder[1])}`)
  expect(
    (text[1] ?? "").includes("The file was downloaded; the page did not change."),
    `the kept navigation did not report the file:\n${(text[1] ?? "").slice(0, 600)}`,
  )
  expect((folder[2] ?? []).length === 1, `the repeat navigation did not save exactly one file: ${JSON.stringify(folder[2])}`)
  expect(text[2]?.includes(APPROVAL), `the third navigation was not guarded again:\n${(text[2] ?? "").slice(0, 600)}`)
  expect((folder[3] ?? []).length === 1, `the third navigation changed the folder: ${JSON.stringify(folder[3])}`)
  expect(hits === 3, `the navigation reached the fixture ${hits} times instead of three`)
  expect(userBefore?.groupId === -1, `the user tab was already grouped: ${JSON.stringify(userBefore)}`)
  expect(userDuring?.groupId === -1, `the user tab entered the agent's group: ${JSON.stringify(userDuring)}`)
  expect(userAfter?.groupId === -1, `the user tab entered the agent's group: ${JSON.stringify(userAfter)}`)
  expect(userAfter?.url === userUrl, `the user tab was navigated: ${JSON.stringify(userAfter)}`)
  const bodies = await downloadBodies()
  expect(bodies.some((body) => body.includes("report-body")), `the kept file has no body: ${JSON.stringify(bodies)}`)
  return {
    folder,
    hits,
    texts: text.slice(0, 3).map((value) => value.slice(0, 400)),
    userTabId,
    userTab: userAfter,
  }
}

/** `browser_tabs new <attachment>`: guarded, then the approved repeat keeps one file on the same tab, no second tab. */
async function downloadTabsNew() {
  const url = `${localOrigin}/download`
  const folder: string[][] = []
  let afterFirst: TabState | undefined
  let afterRepeat: TabState | undefined
  const plan: Plan = async (step) => {
    folder.push(await downloadFiles())
    if (step.results.length === 1) afterFirst = await tabs()
    if (step.results.length === 2) afterRepeat = await tabs()
    if (step.results.length <= 1) return { args: { action: "new", url }, name: "browser_tabs" }
    return undefined
  }

  await clearDownloads()
  const hitsBefore = downloadHits.length
  const result = await run(plan, { allowSensitive: true })
  const text = result.last.results
  const hits = downloadHits.length - hitsBefore
  // The agent's tab is the one in its Kilo group.
  const agentTabs = (state: TabState | undefined) =>
    (state?.tabs ?? [])
      .filter((tab) => tab.groupId !== -1)
      .map((tab) => tab.id)
      .sort()
  expect(text[0]?.includes(APPROVAL), `the guarded tabs-new did not report the approval:\n${(text[0] ?? "").slice(0, 600)}`)
  expect((folder[1] ?? []).length === 0, `the guarded tabs-new created a file: ${JSON.stringify(folder[1])}`)
  expect(
    (text[1] ?? "").includes("The file was downloaded; the page did not change."),
    `the repeat did not report the kept file:\n${(text[1] ?? "").slice(0, 600)}`,
  )
  expect((folder[2] ?? []).length === 1, `the repeat did not save exactly one file: ${JSON.stringify(folder[2])}`)
  expect(
    JSON.stringify(agentTabs(afterFirst)) === JSON.stringify(agentTabs(afterRepeat)),
    `a second tab appeared: ${JSON.stringify(afterFirst?.tabs)} -> ${JSON.stringify(afterRepeat?.tabs)}`,
  )
  expect(agentTabs(afterRepeat).length === 1, `the agent has ${agentTabs(afterRepeat).length} tabs`)
  expect(hits === 2, `the attachment was requested ${hits} times instead of two`)
  const bodies = await downloadBodies()
  expect(bodies.some((body) => body.includes("report-body")), `the kept file has no body: ${JSON.stringify(bodies)}`)
  return {
    agentTabs: agentTabs(afterRepeat),
    folder,
    hits,
    texts: text.slice(0, 2).map((value) => value.slice(0, 400)),
  }
}

/**
 * A tabs-new on a session that already has a tab, with no token: the guarded call must refuse and the folder must stay
 * empty — no later file either, since nothing repeats the step. A silent keep here is a download the user never approved.
 */
async function downloadTabsNewNoToken() {
  const url = `${localOrigin}/download`
  const folder: string[][] = []
  const plan: Plan = async (step) => {
    const index = step.results.length
    if (index === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
    if (index === 1) return { args: {}, name: "browser_snapshot" }
    if (index === 2) return { args: { action: "new", url }, name: "browser_tabs" }
    if (index === 3) {
      folder[3] = await downloadFiles()
      await Bun.sleep(5000)
      folder[4] = await downloadFiles()
      return undefined
    }
    return undefined
  }

  await clearDownloads()
  const result = await run(plan, { allowSensitive: true })
  const text = result.last.results
  const saved = await downloadFiles()
  expect(
    (text[2] ?? "").includes(APPROVAL),
    `the guarded tabs-new did not report the approval:\n${(text[2] ?? "").slice(0, 600)}`,
  )
  expect((folder[3] ?? []).length === 0, `the unapproved tabs-new created a file at once: ${JSON.stringify(folder[3])}`)
  expect(saved.length === 0, `the unapproved tabs-new created a file: ${JSON.stringify(saved)}`)
  return { folder, saved, texts: (text[2] ?? "").slice(0, 400) }
}

/**
 * The approved retry's page also starts a second, different download. Exactly one file is kept — the approved step's
 * own — and the second is stopped and reported, not silently saved.
 */
async function downloadApprovedOne() {
  const linkRef = (snapshot: string) => refOf(snapshot, /link "Get the report" \[ref=([^\]]+)\]/)
  const folder: string[][] = []
  const plan: Plan = async (step) => {
    folder.push(await downloadFiles())
    if (step.results.length === 0) return { args: { url: `${localOrigin}/download-two` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2 || step.results.length === 3) {
      // The guarded click left the folder empty; the approved repeat follows at once.
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { args: { element: "the report link", target: ref }, name: "browser_click" } : undefined
    }
    if (step.results.length === 4) {
      // The approved file is written asynchronously; let it land before the folder is read for this step.
      await until(async () => ((await downloadFiles()).length >= 1 ? true : undefined), 10_000, "the approved file lands").catch(() => undefined)
      folder[4] = await downloadFiles()
      return { args: {}, name: "browser_snapshot" }
    }
    if (step.results.length === 5) {
      // A stopped download must not surface a file later either.
      await Bun.sleep(2500)
      folder[5] = await downloadFiles()
      return undefined
    }
    return undefined
  }

  await clearDownloads()
  const hitsOf = (pathname: string) => downloadHits.filter((hit) => hit.path === pathname).length
  const approvedBefore = hitsOf("/download")
  const secondBefore = hitsOf("/download-second")
  const result = await run(plan, { allowSensitive: true })
  const text = result.last.results
  const hits = { approved: hitsOf("/download") - approvedBefore, second: hitsOf("/download-second") - secondBefore }
  const saved = await downloadFiles()
  const bodies = await downloadBodies()
  const reported = [text[3], text[4], text[5]].map((value) => value ?? "").join("\n")
  expect(text[2]?.includes(APPROVAL), `the guarded click did not report the approval:\n${(text[2] ?? "").slice(0, 600)}`)
  expect((folder[3] ?? []).length === 0, `the guarded click saved a file: ${JSON.stringify(folder[3])}`)
  expect((folder[4] ?? []).length === 1, `the approved repeat did not keep exactly one file: ${JSON.stringify(folder[4])}`)
  expect((folder[5] ?? []).length === 1, `the folder changed after the approved repeat: ${JSON.stringify(folder[5])}`)
  expect(saved.length === 1, `the folder holds ${saved.length} files: ${JSON.stringify(saved)}`)
  expect(bodies.some((body) => body.includes("report-body")), `the approved file was not kept: ${JSON.stringify(bodies)}`)
  expect(!bodies.some((body) => body.includes("second-body")), `the second download was kept: ${JSON.stringify(bodies)}`)
  expect(reported.includes("second.txt"), `the second download was not reported:\n${reported.slice(0, 800)}`)
  expect(reported.includes("permission"), `the second download was not refused:\n${reported.slice(0, 800)}`)
  expect(hits.approved === 2, `the approved route was hit ${hits.approved} times instead of two`)
  expect(hits.second === 2, `the second route was hit ${hits.second} times instead of two`)
  return {
    bodies,
    folder,
    hits,
    saved,
    texts: [text[2], text[3], text[4], text[5]].map((value) => (value ?? "").slice(0, 400)),
  }
}

/** A click whose download starts about 1.5 s later: the next call reports it, and the repeat keeps one file. */
async function downloadLate() {
  const linkRef = (snapshot: string) => refOf(snapshot, /link "Get the report" \[ref=([^\]]+)\]/)
  const folder: string[][] = []
  const plan: Plan = async (step) => {
    folder.push(await downloadFiles())
    const i = step.results.length
    if (i === 0) return { args: { url: `${localOrigin}/download-late-page` }, name: "browser_navigate" }
    if (i === 1) return { args: {}, name: "browser_snapshot" }
    if (i === 2) {
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { args: { element: "the report link", target: ref }, name: "browser_click" } : undefined
    }
    if (i === 3) {
      // The attachment arrives ~1.5 s after the click; the very next call (a snapshot) reports it.
      await Bun.sleep(2400)
      return { args: {}, name: "browser_snapshot" }
    }
    if (i === 4) {
      // The repeat of the step named by the need spends the token and keeps the file.
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { args: { element: "the report link", target: ref }, name: "browser_click" } : undefined
    }
    if (i === 5) {
      // The repeat's attachment is delayed by 1.5 s; then a third identical click without a token is guarded.
      await until(async () => ((await downloadFiles()).length === 1 ? true : undefined), 10_000, "the kept late file lands")
      folder[5] = await downloadFiles()
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { args: { element: "the report link", target: ref }, name: "browser_click" } : undefined
    }
    if (i === 6) {
      // The third click's own late download is stopped by its linger; the folder must not grow.
      await Bun.sleep(2200)
      folder[6] = await downloadFiles()
      return undefined
    }
    return undefined
  }

  await clearDownloads()
  const hitsBefore = downloadHits.length
  const result = await run(plan, { allowSensitive: true })
  const text = result.last.results
  const hits = downloadHits.length - hitsBefore
  expect((folder[3] ?? []).length === 0, `the click started a download at once: ${JSON.stringify(folder[3])}`)
  expect(!(text[2] ?? "").includes(APPROVAL), `the click itself caught the late download, not the next call:\n${(text[2] ?? "").slice(0, 400)}`)
  expect(
    (text[3] ?? "").includes("started a download of report.txt") && (text[3] ?? "").includes("Repeat that step"),
    `the next call did not report the late download with its file:\n${(text[3] ?? "").slice(0, 600)}`,
  )
  expect(!(text[4] ?? "").includes("permission"), `the repeated click was refused:\n${(text[4] ?? "").slice(0, 600)}`)
  expect((folder[5] ?? []).length === 1, `the repeat did not save exactly one file: ${JSON.stringify(folder[5])}`)
  expect(!(text[5] ?? "").includes("Approval"), `the third click asked for approval instead of being guarded:\n${(text[5] ?? "").slice(0, 600)}`)
  expect((folder[6] ?? []).length === 1, `the third click kept a new file: ${JSON.stringify(folder[6])}`)
  expect(hits === 3, `the late route served ${hits} times instead of three`)
  const bodies = await downloadBodies()
  expect(bodies.some((body) => body.includes("report-body")), `the kept file has no body: ${JSON.stringify(bodies)}`)
  return { code: result.code, folder, hits, texts: [text[2], text[3], text[4], text[5]].map((value) => (value ?? "").slice(0, 400)) }
}

/** The shipped build (downloads not granted): a download-capable call is refused with the re-grant text, no file. */
async function downloadUngranted() {
  const linkRef = (snapshot: string) => refOf(snapshot, /link "Get the report" \[ref=([^\]]+)\]/)
  const plan: Plan = (step) => {
    if (step.results.length === 0) return { args: { url: `${localOrigin}/download-page` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      const ref = linkRef(step.results[1] ?? "")
      return ref ? { args: { element: "the report link", target: ref }, name: "browser_click" } : undefined
    }
    return undefined
  }

  await clearDownloads()
  const hitsBefore = downloadHits.length
  const result = await run(plan, { allowSensitive: true })
  const text = result.last.results
  // Every download-capable tool is fail-closed without the permission; navigation itself is one, so the first call
  // may be the refused one and the click is never reached.
  const refused = [text[0], text[2]].find((value) => (value ?? "").includes("optional Downloads permission is not granted")) ?? text[2] ?? ""
  const files = await downloadFiles()
  expect(refused.includes("optional Downloads permission is not granted"), `no call was refused for the permission:\n${JSON.stringify(text.map((value) => value.slice(0, 200)))}`)
  expect(refused.includes("blocked"), `the refusal is not the blocked state:\n${refused.slice(0, 600)}`)
  expect(files.length === 0, `a file appeared without the permission: ${JSON.stringify(files)}`)
  expect(downloadHits.length - hitsBefore === 0, `a download-capable call reached the fixture without the permission`)
  return { calls: text.map((value) => value.slice(0, 200)), files, hits: downloadHits.length - hitsBefore, refused: refused.slice(0, 500) }
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

const scenarios: Record<string, () => Promise<Record<string, unknown>>> = {
  "download-path": downloadPath,
  "navigate-snapshot": navigateSnapshot,
  permission,
  frames,
  sensitive,
  group,
  stop,
  unpaired,
  download,
  "download-navigate": downloadNavigate,
  "download-ungranted": downloadUngranted,
  "download-late": downloadLate,
  "download-tabs-new": downloadTabsNew,
  "download-tabs-new-notoken": downloadTabsNewNoToken,
  "download-approved-one": downloadApprovedOne,
  "download-approved-one-multi": downloadApprovedOne,
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name)
  return at < 0 ? undefined : process.argv[at + 1]
}

function hubPorts(offset: number): number[] | undefined {
  const match = /^(\d+)-(\d+)$/.exec(process.env.E2E_HUB_PORTS ?? "")
  if (!match) return undefined
  const first = Number(match[1])
  const all = Array.from({ length: Number(match[2]) - first + 1 }, (_, index) => first + index)
  const start = offset % all.length
  return [...all.slice(start), ...all.slice(0, start)]
}

type Outcome = { failure: string; pass: boolean; repeat: number; scenario: string; seconds: number }

/** `all`: every scenario in its own child process with its own scratch root, one after another. */
async function runAll(): Promise<number> {
  const repeat = Math.max(1, Number(option("--repeat") ?? "1"))
  const only = option("--only")?.split(",").filter(Boolean)
  const names = only ?? Object.keys(scenarios)
  const unknown = names.filter((name) => !(name in scenarios))
  if (unknown.length) throw new Error(`unknown scenario(s) ${unknown.join(", ")}; choose ${Object.keys(scenarios).join(", ")}`)
  const root = process.env.E2E_HOME ?? (await fs.mkdtemp(path.join(os.tmpdir(), "bridge-e2e-all-")))
  const out = path.resolve(option("--out") ?? path.join(root, "reports"))
  await fs.mkdir(out, { recursive: true })
  const outcomes: Outcome[] = []
  let child = 0
  for (let round = 1; round <= repeat; round++) {
    for (const name of names) {
      const home = path.join(root, `${name}-${round}`)
      await fs.rm(home, { force: true, recursive: true })
      const started = performance.now()
      const spawned = Bun.spawn([process.execPath, import.meta.path, binary, name], {
        env: {
          ...process.env,
          E2E_HOME: home,
          ...(process.env.E2E_HUB_PORTS ? { E2E_HUB_PORT_OFFSET: String(child * 4) } : {}),
        },
        stderr: "pipe",
        stdout: "pipe",
        timeout: 15 * 60_000,
      })
      child += 1
      const [stdout, stderr, code] = await Promise.all([
        new Response(spawned.stdout as ReadableStream).text(),
        new Response(spawned.stderr as ReadableStream).text(),
        spawned.exited,
      ])
      const seconds = (performance.now() - started) / 1000
      await fs.writeFile(path.join(out, `${name}-${round}.json`), stdout)
      if (stderr) await fs.writeFile(path.join(out, `${name}-${round}.stderr.txt`), stderr)
      let failure = ""
      try {
        const parsed = record(JSON.parse(stdout.slice(stdout.indexOf("{"))))
        const list = parsed?.["failures"]
        if (Array.isArray(list) && list.length) failure = String(list[0])
      } catch {
        failure = `no JSON report (exit ${code}): ${(stderr.trim().split("\n").at(-1) ?? "").trim()}`
      }
      if (!failure && code !== 0) failure = `exit ${code}`
      const outcome: Outcome = { failure: failure.split("\n")[0]?.slice(0, 160) ?? "", pass: code === 0 && !failure, repeat: round, scenario: name, seconds }
      outcomes.push(outcome)
      console.error(`${outcome.pass ? "PASS" : "FAIL"} ${name} #${round} ${seconds.toFixed(1)}s ${outcome.failure}`)
    }
  }
  const width = Math.max(...outcomes.map((outcome) => outcome.scenario.length), "scenario".length)
  const lines = [
    `| ${"scenario".padEnd(width)} | run | result | seconds | failure |`,
    `| ${"-".repeat(width)} | --- | ------ | ------- | ------- |`,
    ...outcomes.map(
      (outcome) =>
        `| ${outcome.scenario.padEnd(width)} | ${String(outcome.repeat).padStart(3)} | ${outcome.pass ? "pass  " : "FAIL  "} | ${outcome.seconds.toFixed(1).padStart(7)} | ${outcome.failure.replaceAll("|", "\\|")} |`,
    ),
    "",
    ...names.map((name) => {
      const mine = outcomes.filter((outcome) => outcome.scenario === name)
      return `${name.padEnd(width)}  ${mine.filter((outcome) => outcome.pass).length}/${mine.length} pass`
    }),
    `total ${outcomes.filter((outcome) => outcome.pass).length}/${outcomes.length} pass; reports in ${out}`,
  ]
  const table = lines.join("\n")
  await fs.writeFile(path.join(out, "summary.md"), `${table}\n`)
  console.log(table)
  return outcomes.every((outcome) => outcome.pass) ? 0 : 1
}

if (scenario === "all") {
  process.exit(await runAll())
}

const selected = scenarios[scenario]
if (!selected) throw new Error(`unknown scenario ${scenario}; choose all, ${Object.keys(scenarios).join(", ")}`)

const base = process.env.E2E_HOME ?? (await fs.mkdtemp(path.join(os.tmpdir(), "bridge-e2e-")))
await fs.mkdir(base, { recursive: true })
const stopFixtures = startFixtures()
const model = startModel()

// Every scenario runs against the accepted-permission state (a copy with `downloads` promoted to required) except
// download-ungranted, which loads the shipped build where `downloads` stays optional and unrequested.
const promoted = scenario !== "download-ungranted"
const extension = promoted ? await promoteDownloadsCopy(extensionDirectory, path.join(base, "extension-downloads")) : extensionDirectory
// Chrome's own default download directory, set in the profile before launch; every scenario reads it.
downloadsPath = path.join(base, "downloads")

try {
  launched = await launchChromium({
    downloads: downloadsPath,
    extension,
    profile: path.join(base, "profile"),
    preferences: {
      ...(scenario === "download-approved-one-multi"
        ? { profile: { default_content_setting_values: { automatic_downloads: 1 } } }
        : {}),
      ...(process.env.E2E_PREFERENCES ? (JSON.parse(process.env.E2E_PREFERENCES) as Record<string, unknown>) : {}),
    },
  })
  const ports = hubPorts(Number(process.env.E2E_HUB_PORT_OFFSET ?? "0"))
  bridge = { base, binary, browser: launched, model, ...(ports ? { ports } : {}) }
  if (scenario === "unpaired" || scenario === "download-path") {
    panel = await launched.context.newPage()
  } else {
    const enabled = await enableLocalAgents(launched)
    panel = enabled.panel
    const settings = record(record(enabled.stored)?.["kiloLocalAgentSettings"])
    expect(settings?.["enabled"] === true, `the switch did not persist: ${JSON.stringify(enabled.stored)}`)
  }
  const results = await selected()
  // Chrome's own record of every download (state, error, final name), the ground truth next to the folder.
  if (promoted && scenario.startsWith("download")) results["downloadItems"] = await downloadItems(launched.worker)
  // A failed run keeps a picture of the whole virtual screen: Chrome's own prompts and bubbles are outside the page.
  if (failures.length && process.env.DISPLAY) {
    await Bun.spawn(["import", "-window", "root", path.join(base, "screen-final.png")], { stderr: "ignore", stdout: "ignore" }).exited.catch(() => 1)
    results["screen"] = path.join(base, "screen-final.png")
  }
  expect(
    launched.cdp.downloadBehavior.length === 0,
    `the harness sent a DevTools download override: ${JSON.stringify(launched.cdp.downloadBehavior)}`,
  )
  console.log(JSON.stringify(report(results), null, 2))
  if (failures.length) process.exitCode = 1
} catch (error) {
  failures.push(`harness: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  console.log(JSON.stringify(report({}), null, 2))
  process.exitCode = 1
} finally {
  await launched?.close().catch(() => undefined)
  stopFixtures()
  model.stop()
}
