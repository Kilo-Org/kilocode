#!/usr/bin/env bun
// Real end-to-end exploration of the Kilo v2 VS Code extension (`kilocode.kilo-code-v2`) driving the Kilo browser
// extension through the CLI's `extension` backend. Not a `bun test` file: it needs a display (run it under xvfb), VS
// Code stable (tarball), the packaged VSIX (which carries `bin/kilo2`), the built Chrome MV3 extension and, for the
// chat scenarios, an OpenRouter key.
//
//   xvfb-run -a -s "-screen 0 1920x1080x24" bun test/browser/vscode-e2e.ts serve       # control server, step by step
//   xvfb-run -a -s "-screen 0 1920x1080x24" bun test/browser/vscode-e2e.ts run [steps]  # the scripted walk
//
//   VSC_E2E_CODE       the VS Code executable (`<tarball>/code`)
//   VSC_E2E_VSIX       the packaged VSIX (`packages/kilo-vscode/out/kilo-vscode-linux-x64.vsix`)
//   E2E_EXTENSION_DIR  the built unpacked browser extension (`apps/extension/.output/chrome-mv3`)
//   E2E_CHROMIUM       the Chromium executable (default: playwright-core's own build)
//   VSC_E2E_ROOT       the run root, wiped at start (default: /tmp/vscode-e2e-<pid>)
//   VSC_E2E_EVIDENCE   where screenshots and the JSON report go (default: <root>/evidence)
//   VSC_E2E_PORT       base port: hub = base, fixture = base + 1, control server = base + 49 (default 48250)
//   VSC_E2E_MODEL_ENV  a file with OPENROUTER_API_KEY=...; the key reaches VS Code's environment only, through the
//                      config's `{env:OPENROUTER_API_KEY}`, and is never printed
//   VSC_E2E_MODEL      the OpenRouter model (default deepseek/deepseek-v4.1-flash)
//
// The product path: VS Code starts its bundled `kilo2 serve`; the CLI's extension backend dials the registered loopback
// hub (started here on the run's port so parallel runs never share 47917), finds it unpaired and opens the pairing page
// with the system opener. `xdg-open` on PATH is a recorder: the harness opens each recorded URL in the Chromium that
// holds the extension, the way a default browser would. Everything the user sees is driven through the UI: the Kilo
// sidebar, the Settings panel's Web Tools tab, the permission dock, and the extension's Local agents settings.
import fs from "node:fs/promises"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import net from "node:net"

// biome-ignore lint: the harness drives Playwright objects through a narrow dynamic surface.
type Any = any

const mode = process.argv[2] ?? "serve"
// playwright-core belongs to the plugin workspace, not this package: resolved from there at runtime, as the other
// browser runners do, because a static import would depend on hoisting the workspace does not promise.
const pluginDirectory = path.resolve(import.meta.dirname, "../../../kilo-plugin")
const playwright = (await import(Bun.resolveSync("playwright-core", pluginDirectory))) as Any

const codeExecutable = required("VSC_E2E_CODE")
const vsix = required("VSC_E2E_VSIX")
const extensionDirectory = required("E2E_EXTENSION_DIR")
const chromiumExecutable = process.env.E2E_CHROMIUM ?? playwright.chromium.executablePath()
const root = process.env.VSC_E2E_ROOT ?? path.join(os.tmpdir(), `vscode-e2e-${process.pid}`)
const evidence = process.env.VSC_E2E_EVIDENCE ?? path.join(root, "evidence")
const basePort = Number(process.env.VSC_E2E_PORT ?? 48250)
const hubPort = basePort
const fixturePort = basePort + 1
const controlPort = basePort + 49
const modelId = process.env.VSC_E2E_MODEL ?? "deepseek/deepseek-v4.1-flash"
const provider = "e2e-openrouter"

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required (see the header of this file)`)
  return value
}

function openrouterKey(): string | undefined {
  const file = process.env.VSC_E2E_MODEL_ENV
  if (!file || !existsSync(file)) return undefined
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((entry) => entry.startsWith("OPENROUTER_API_KEY="))
  return line?.slice("OPENROUTER_API_KEY=".length).trim().replace(/^"|"$/g, "") || undefined
}

const sleep = (ms: number) => Bun.sleep(ms)

async function until<T>(check: () => Promise<T | undefined> | T | undefined, timeout = 20_000, label = "condition") {
  const deadline = Date.now() + timeout
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value !== undefined && value !== false) return value as T
    } catch (error) {
      last = error
    }
    await sleep(200)
  }
  throw new Error(`timed out waiting for ${label}${last ? `: ${String(last)}` : ""}`)
}

// ---------------------------------------------------------------------------------------------
// Layout: one run root with an isolated HOME and XDG tree that VS Code, its CLI and the hub share.
// ---------------------------------------------------------------------------------------------

const dirs = {
  home: path.join(root, "home"),
  bin: path.join(root, "bin"),
  run: path.join(root, "run"),
  workspace: path.join(root, "workspace"),
  user: path.join(root, "vscode-user"),
  extensions: path.join(root, "vscode-extensions"),
  chromium: path.join(root, "chromium-profile"),
}
const xdg = {
  XDG_CACHE_HOME: path.join(root, "home", ".cache"),
  XDG_CONFIG_HOME: path.join(root, "home", ".config"),
  XDG_DATA_HOME: path.join(root, "home", ".local", "share"),
  XDG_STATE_HOME: path.join(root, "home", ".local", "state"),
  XDG_RUNTIME_DIR: dirs.run,
}
const openerLog = path.join(root, "opener.log")
const configFile = path.join(xdg.XDG_CONFIG_HOME, "kilo2", "kilo2.jsonc")
const hubsDirectory = path.join(xdg.XDG_STATE_HOME, "kilo2", "browser", "run", "hubs")

function config(browser: Record<string, unknown> = {}) {
  return {
    $schema: "https://app.kilo.ai/config.json",
    model: `${provider}/${modelId}`,
    providers: {
      [provider]: {
        name: "OpenRouter (e2e)",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { apiKey: "{env:OPENROUTER_API_KEY}", baseURL: "https://openrouter.ai/api/v1" },
        models: { [modelId]: { name: "DeepSeek V4.1 Flash", limit: { context: 1_000_000, output: 32_000 } } },
      },
    },
    browser,
  }
}

async function prepare() {
  await fs.rm(root, { recursive: true, force: true })
  for (const dir of [...Object.values(dirs), ...Object.values(xdg), evidence]) await fs.mkdir(dir, { recursive: true })
  await fs.chmod(dirs.run, 0o700)
  await fs.mkdir(path.dirname(configFile), { recursive: true })
  await fs.writeFile(configFile, JSON.stringify(config(), null, 2))
  await fs.writeFile(path.join(dirs.workspace, "README.md"), "# e2e workspace\n\nA scratch project for the VS Code e2e.\n")
  // The system opener the CLI calls for the pairing page: record it; the harness opens it in the extension's Chromium.
  await fs.writeFile(
    path.join(dirs.bin, "xdg-open"),
    `#!/bin/sh\nprintf '%s\\n' "$1" >> '${openerLog}'\nexit 0\n`,
    { mode: 0o755 },
  )
  await fs.mkdir(path.join(dirs.user, "User"), { recursive: true })
  await fs.writeFile(
    path.join(dirs.user, "User", "settings.json"),
    JSON.stringify(
      {
        "workbench.startupEditor": "none",
        "telemetry.telemetryLevel": "off",
        "security.workspace.trust.enabled": false,
        "extensions.autoUpdate": false,
        "extensions.autoCheckUpdates": false,
        "update.mode": "none",
        "window.restoreWindows": "none",
        "workbench.tips.enabled": false,
        "workbench.enableExperiments": false,
        "chat.disableAIFeatures": true,
        "window.newWindowDimensions": "maximized",
        "window.titleBarStyle": "custom",
      },
      null,
      2,
    ),
  )
}

let extensionId = ""

function environment(extra: Record<string, string> = {}) {
  const key = openrouterKey()
  return {
    ...process.env,
    HOME: dirs.home,
    ...xdg,
    PATH: `${dirs.bin}:${process.env.PATH ?? ""}`,
    KILO_DISABLE_AUTOUPDATE: "1",
    KILO_BROWSER_EXTRA_EXTENSION_IDS: extensionId,
    NO_PROXY: "127.0.0.1,127.0.0.2,localhost",
    no_proxy: "127.0.0.1,127.0.0.2,localhost",
    ...(key ? { OPENROUTER_API_KEY: key } : {}),
    ...extra,
  } as Record<string, string>
}

// ---------------------------------------------------------------------------------------------
// Fixture: the same pages on 127.0.0.1 (the localhost family: allowed by default) and 127.0.0.2 (an ordinary origin
// that asks), so the permission and sensitive-step prompts appear without a public site.
// ---------------------------------------------------------------------------------------------

const PAGES: Record<string, string> = {
  "/": `<!doctype html><title>Fixture shop</title><h1>Fixture shop</h1>
<p id="price">Widget price: $42.17</p>
<ul><li>Alpha gadget</li><li>Beta gadget</li><li>Gamma gadget</li></ul>
<p><a href="/login">Sign in</a> · <a href="/about">About</a></p>`,
  "/about": `<!doctype html><title>About the shop</title><h1>About</h1><p>The shop opened in 2019 and sells 3 gadgets.</p>`,
  "/login": `<!doctype html><title>Sign in</title><h1>Sign in</h1>
<form onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'Signed in as ' + this.user.value">
<label>User <input name="user" id="user" autocomplete="username"></label>
<label>Password <input name="password" id="password" type="password" autocomplete="current-password"></label>
<button type="submit">Sign in</button></form><p id="out"></p>`,
}

function fixture(hostname: string) {
  return Bun.serve({
    hostname,
    port: fixturePort,
    fetch(request) {
      const url = new URL(request.url)
      const page = PAGES[url.pathname]
      if (!page) return new Response("not found", { status: 404 })
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } })
    },
  })
}

// ---------------------------------------------------------------------------------------------
// Chromium with the real extension, "Allow local agents" on, and the opener recorder replayed into it.
// ---------------------------------------------------------------------------------------------

let context: Any
let panel: Any
let worker: Any

/**
 * A copy of the built extension with the optional `downloads` permission promoted to required: automation cannot
 * answer Chrome's optional-permission prompt, and this is the state after the user accepts it (the cloud e2e and
 * extension-e2e.ts do the same). `VSC_E2E_GRANT_DOWNLOADS=0` keeps the manifest as built: the declined-prompt state.
 */
async function extensionCopy() {
  if (process.env.VSC_E2E_GRANT_DOWNLOADS === "0") return extensionDirectory
  const target = path.join(root, "extension")
  await fs.cp(extensionDirectory, target, { recursive: true })
  const file = path.join(target, "manifest.json")
  const manifest = JSON.parse(await fs.readFile(file, "utf8"))
  manifest.optional_permissions = (manifest.optional_permissions ?? []).filter((name: string) => name !== "downloads")
  manifest.permissions = [...new Set([...(manifest.permissions ?? []), "downloads"])]
  await fs.writeFile(file, JSON.stringify(manifest, null, 2))
  return target
}

async function launchChromium() {
  await fs.access(path.join(extensionDirectory, "manifest.json"))
  const extension = await extensionCopy()
  context = await playwright.chromium.launchPersistentContext(dirs.chromium, {
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--disable-blink-features=AutomationControlled",
      "--window-position=1150,0",
      "--window-size=770,1050",
    ],
    executablePath: chromiumExecutable,
    headless: false,
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: null,
  })
  context.setDefaultTimeout(20_000)
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  extensionId = new URL(worker.url()).host
}

/** Turns on "Allow local agents" through the extension's own settings page, as a signed-in user would. */
async function enableLocalAgents() {
  // The account API the side panel validates against: app.kilo.ai for a production build, localhost:3000 for a
  // development build. Both are faked, so a service another process runs on :3000 cannot sign the panel out.
  const account = (url: URL) => url.origin === "https://app.kilo.ai" || url.origin === "http://localhost:3000"
  await context.route(
    (url: URL) => account(url) && url.pathname.startsWith("/api/"),
    (route: Any) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === "/api/user") return route.fulfill({ json: { google_user_email: "e2e@kilo.ai" }, status: 200 })
      if (pathname === "/api/organizations") return route.fulfill({ json: { organizations: [] }, status: 200 })
      return route.fulfill({ json: {}, status: 200 })
    },
  )
  // A real user answers the optional-permission prompt; automation cannot.
  await context.addInitScript({
    content: "Object.defineProperty(chrome.permissions, 'request', { value: () => Promise.resolve(true) });",
  })
  panel = await context.newPage()
  panel.setDefaultTimeout(20_000)
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await panel.evaluate(
    () =>
      new Promise<void>((resolve) =>
        (globalThis as Any).chrome.storage.local.set({ kiloAuth: { token: "token-1", userEmail: "e2e@kilo.ai" } }, () =>
          resolve(),
        ),
      ),
  )
  await panel.reload()
  try {
    await setLocalAgents(true)
  } catch (error) {
    await panel.screenshot({ path: path.join(evidence, "boot-local-agents-failed.png") }).catch(() => undefined)
    throw error
  }
}

async function openLocalAgentsSettings() {
  const toggle = panel.getByRole("switch", { name: "Allow local agents" })
  if (!(await toggle.isVisible().catch(() => false))) {
    const settings = panel.getByRole("button", { name: "Settings" })
    await settings.waitFor()
    await settings.click()
  }
  await toggle.waitFor()
  return toggle
}

async function setLocalAgents(on: boolean) {
  const toggle = await openLocalAgentsSettings()
  if (((await toggle.getAttribute("aria-checked")) === "true") !== on) await toggle.click()
  await until(async () => ((await toggle.getAttribute("aria-checked")) === "true") === on, 10_000, `switch ${on}`)
}

/** Replays every URL the CLI handed to `xdg-open` into the extension's Chromium (a tab with no opener). */
const opened: { url: string; at: number }[] = []
async function replayOpener() {
  let seen = 0
  for (;;) {
    const lines = existsSync(openerLog) ? readFileSync(openerLog, "utf8").split("\n").filter(Boolean) : []
    for (const url of lines.slice(seen)) {
      opened.push({ url: url.replace(/#.*/, "#<redacted>"), at: Date.now() })
      // A new window: a tab CDP adds to an existing window inherits the active tab as its opener, and the extension
      // ignores a pairing page that has an opener (a page could open it itself).
      const cdp = await context.browser().newBrowserCDPSession()
      await cdp.send("Target.createTarget", { newWindow: true, url }).catch(() => undefined)
    }
    seen = lines.length
    await sleep(250)
  }
}

// ---------------------------------------------------------------------------------------------
// Hub: one loopback hub on this run's port, registered in the run's state dir, so VS Code's CLI dials it.
// ---------------------------------------------------------------------------------------------

let hub: Any
const hubLog = { text: "" }

/** The `kilo2` the installed VSIX carries: the same binary VS Code starts as its server. */
function kilo2() {
  const found = (existsSync(dirs.extensions) ? readdirSync(dirs.extensions) : []).find((entry) =>
    entry.startsWith("kilocode.kilo-code-v2-"),
  )
  if (!found) throw new Error("the VSIX is not installed")
  return path.join(dirs.extensions, found, "bin", "kilo2")
}

async function hubEntries() {
  const files = await fs.readdir(hubsDirectory).catch(() => [] as string[])
  const out: Any[] = []
  for (const file of files.filter((entry) => entry.endsWith(".json")))
    out.push(JSON.parse(await fs.readFile(path.join(hubsDirectory, file), "utf8").catch(() => "{}")))
  return out
}

async function startHub() {
  hub = Bun.spawn([kilo2(), "browser", "hub", "--loopback", "--port", String(hubPort)], {
    cwd: dirs.home,
    env: environment(),
    stdout: "pipe",
    stderr: "pipe",
  })
  for (const stream of [hub.stdout, hub.stderr])
    void (async () => {
      for await (const chunk of stream as AsyncIterable<Uint8Array>) hubLog.text += new TextDecoder().decode(chunk)
    })()
  await until(async () => (await hubEntries())[0], 30_000, "the hub registers")
}

async function stopHub() {
  try {
    hub?.kill("SIGTERM")
  } catch {}
  await Promise.race([hub?.exited, sleep(5_000)])
}

/** One JSON-RPC call the hub answers itself (`pairing.url`), over the 4-byte-framed CLI socket. */
async function hubRequest(socketPath: string, method: string) {
  const socket = net.createConnection(socketPath)
  const connected = Promise.withResolvers<void>()
  socket.once("connect", connected.resolve)
  socket.once("error", connected.reject)
  await connected.promise
  const { promise, resolve, reject } = Promise.withResolvers<Any>()
  let buffer = Buffer.alloc(0)
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0)
      if (buffer.length < 4 + length) return
      const frame = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8"))
      buffer = buffer.subarray(4 + length)
      if (frame?.type === "rpc" && frame.message?.id === 1) {
        socket.end()
        if (frame.message.error) reject(new Error(frame.message.error.message))
        else resolve(frame.message.result)
      }
    }
  })
  const body = Buffer.from(JSON.stringify({ type: "rpc", message: { jsonrpc: "2.0", id: 1, method, params: {} } }))
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  socket.write(Buffer.concat([header, body]))
  return await promise
}

// ---------------------------------------------------------------------------------------------
// VS Code: install the VSIX into the isolated extensions dir, launch through Playwright's Electron driver.
// ---------------------------------------------------------------------------------------------

let app: Any
let code: Any

async function installVsix() {
  // `bin/code` is the CLI wrapper (Electron as Node); the Electron binary itself would open a window instead.
  const child = Bun.spawn(
    [
      path.join(path.dirname(codeExecutable), "bin", "code"),
      "--user-data-dir",
      dirs.user,
      "--extensions-dir",
      dirs.extensions,
      "--install-extension",
      vsix,
      "--force",
    ],
    { env: environment(), stdout: "pipe", stderr: "pipe" },
  )
  const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exit !== 0) throw new Error(`VSIX install failed (${exit}): ${out}\n${err}`)
  return out.trim().split("\n").slice(-1)[0]
}

async function launchVsCode() {
  app = await playwright._electron.launch({
    executablePath: codeExecutable,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-telemetry",
      "--user-data-dir",
      dirs.user,
      "--extensions-dir",
      dirs.extensions,
      dirs.workspace,
    ],
    env: environment(),
    timeout: 60_000,
  })
  code = await app.firstWindow()
  code.setDefaultTimeout(20_000)
  await code.waitForSelector(".monaco-workbench", { timeout: 60_000 })
  await code.setViewportSize?.({ width: 1600, height: 1000 }).catch(() => undefined)
}

async function command(title: string) {
  await code.keyboard.press("F1")
  const input = code.locator(".quick-input-widget input")
  await input.waitFor()
  await input.fill(`>${title}`)
  await sleep(500)
  await code.keyboard.press("Enter")
}

/** The webview frame (a `vscode-webview://` iframe) whose document text contains `text`. */
async function webview(text: string, timeout = 20_000) {
  return await until(
    async () => {
      for (const frame of code.frames()) {
        if (!frame.url().startsWith("vscode-webview://")) continue
        const body = await frame.evaluate(() => document.body?.innerText ?? "").catch(() => "")
        if (body.includes(text)) return frame
      }
      return undefined
    },
    timeout,
    `a webview showing "${text}"`,
  )
}

/** Every webview frame with its first characters, for exploration. */
async function webviews() {
  const out: { url: string; text: string }[] = []
  for (const frame of code.frames()) {
    if (!frame.url().startsWith("vscode-webview://")) continue
    const text = await frame.evaluate(() => document.body?.innerText ?? "").catch(() => "<unreadable>")
    out.push({ url: frame.url().slice(0, 160), text: text.slice(0, 400) })
  }
  return out
}

const shots: string[] = []
async function shot(name: string, target: Any = code) {
  const file = path.join(evidence, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`)
  await target.screenshot({ path: file })
  shots.push(file)
  return file
}

/** The whole X display: VS Code and Chromium side by side. */
async function screen(name: string) {
  const file = path.join(evidence, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`)
  const child = Bun.spawn(["import", "-window", "root", file], { stdout: "ignore", stderr: "pipe" })
  await child.exited
  shots.push(file)
  return file
}

/** OpenRouter's running total for the key, so the report states the real spend. */
async function spend() {
  const key = openrouterKey()
  if (!key) return undefined
  const response = await fetch("https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${key}` } })
  const body = (await response.json()) as Any
  return typeof body?.data?.usage === "number" ? body.data.usage : undefined
}

async function tabState() {
  const tabs = await worker.evaluate(() => (globalThis as Any).chrome.tabs.query({}))
  const groups = await worker.evaluate(() => (globalThis as Any).chrome.tabGroups.query({}))
  return {
    tabs: tabs.map((tab: Any) => ({ id: tab.id, url: tab.url, title: tab.title, groupId: tab.groupId, active: tab.active })),
    groups: groups.map((group: Any) => ({ id: group.id, title: group.title, color: group.color, collapsed: group.collapsed })),
  }
}

// ---------------------------------------------------------------------------------------------
// Boot, then either a control server (POST /eval with an async function body) or the scripted steps.
// ---------------------------------------------------------------------------------------------

const ctx = {
  get app() {
    return app
  },
  get code() {
    return code
  },
  get context() {
    return context
  },
  get panel() {
    return panel
  },
  get worker() {
    return worker
  },
  get extensionId() {
    return extensionId
  },
  root,
  dirs,
  xdg,
  configFile,
  evidence,
  hubPort,
  fixture: { local: `http://127.0.0.1:${fixturePort}`, remote: `http://127.0.0.2:${fixturePort}` },
  opened,
  hubLog,
  shots,
  fs,
  path,
  sleep,
  until,
  command,
  webview,
  webviews,
  shot,
  screen,
  spend,
  tabState,
  hubEntries,
  hubRequest,
  startHub,
  stopHub,
  setLocalAgents,
  openLocalAgentsSettings,
  config,
  kilo2,
  launchVsCode,
}

async function boot() {
  await prepare()
  fixture("127.0.0.1")
  fixture("127.0.0.2")
  await launchChromium()
  await enableLocalAgents()
  void replayOpener()
  const installed = await installVsix()
  await startHub()
  await launchVsCode()
  return { extensionId, installed, kilo2: kilo2(), hub: (await hubEntries())[0], spend: await spend() }
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor

async function serve() {
  const booted = await boot()
  console.log(JSON.stringify({ booted }))
  Bun.serve({
    hostname: "127.0.0.1",
    port: controlPort,
    idleTimeout: 0,
    async fetch(request) {
      const body = await request.text()
      try {
        const result = await new AsyncFunction("ctx", body)(ctx)
        return Response.json({ ok: true, result })
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) })
      }
    },
  })
  console.log(`control server on http://127.0.0.1:${controlPort}`)
  const stop = async () => {
    await app?.close().catch(() => undefined)
    await context?.close().catch(() => undefined)
    await stopHub()
    process.exit(0)
  }
  process.on("SIGTERM", stop)
  process.on("SIGINT", stop)
}

// ---------------------------------------------------------------------------------------------
// The scripted walk: every surface and state the exploration covered, in one process. Each step records what it saw
// (text, screenshots, tab groups, hub registry) and never stops the walk; the JSON report goes to <evidence>.
// ---------------------------------------------------------------------------------------------

/** The Kilo sidebar's chat webview: the newest frame with the composer. */
async function chatFrame() {
  return await until(
    async () => {
      for (const frame of [...code.frames()].reverse()) {
        if (!frame.url().startsWith("vscode-webview://")) continue
        if ((await frame.locator("textarea.prompt-input").count().catch(() => 0)) > 0) return frame
      }
      return undefined
    },
    40_000,
    "the chat composer",
  )
}

async function settingsFrame() {
  return await webview("Site permissions", 40_000)
}

async function sidebarAction(label: string) {
  await code.click(`.part.sidebar .actions-container a[aria-label^="${label}"]`)
  await sleep(1500)
}

/** Re-open the Web Tools tab so the panel reads the config and the status again, and return the Status rows. */
async function webToolsStatus(scrollTo = "Status") {
  const frame = await settingsFrame()
  await frame.getByText("Models", { exact: true }).first().click()
  await sleep(400)
  await frame.getByText("Web Tools", { exact: true }).first().click()
  await sleep(2500)
  await frame.getByText(scrollTo, { exact: true }).first().scrollIntoViewIfNeeded()
  const text: string = await frame.evaluate(() => document.body.innerText)
  return { frame, status: text.match(/Status\n[\s\S]*?Site permissions/)?.[0], sites: text.match(/Site permissions[\s\S]*$/)?.[0] }
}

type Dock = { kind: string; resource: string; buttons: string[]; message: string; answered: string }
type Policy = (dock: Omit<Dock, "answered">, seen: Dock[]) => string

/** Reads the permission dock, if one is open: the action label, the resource lines, the hint, and its buttons. */
function readDock(text: string): Omit<Dock, "answered"> | undefined {
  const at = text.lastIndexOf("Permission required")
  if (at < 0) return undefined
  const body = text.slice(at + "Permission required".length).split("\n").map((line) => line.trim()).filter(Boolean)
  const end = body.findIndex((line) => line === "Allow once")
  if (end < 0) return undefined
  const buttons = body.slice(end).filter((line) => ["Allow once", "Allow always", "Allow all sites", "Reject"].includes(line))
  const head = body.slice(0, end)
  const message = head.length > 2 ? head[0] : ""
  return { kind: head[head.length - 2] ?? "", resource: head[head.length - 1] ?? "", buttons, message }
}

/** One chat turn: send, answer every dock with the policy, and return when the transcript stops changing. */
async function turn(name: string, prompt: string, policy: Policy, maxSeconds = 240) {
  const chat = await chatFrame()
  const input = chat.locator("textarea.prompt-input").first()
  await input.focus()
  await input.fill(prompt)
  const t0 = Date.now()
  await input.press("Enter")
  const docks: Dock[] = []
  let text = ""
  let last = ""
  let stable = 0
  while (Date.now() - t0 < maxSeconds * 1000) {
    await sleep(1000)
    text = await chat.evaluate(() => document.body.innerText)
    const dock = Date.now() - t0 > 2000 ? readDock(text) : undefined
    if (dock) {
      const answered = policy(dock, docks)
      docks.push({ ...dock, answered })
      await shot(`${name}-dock-${docks.length}-${dock.kind.replace(/\W+/g, "_")}`)
      await chat.getByRole("button", { name: answered, exact: true }).last().click({ force: true })
      await sleep(1500)
      stable = 0
      continue
    }
    const running = (await chat.getByRole("button", { name: "Stop", exact: true }).count()) > 0
    stable = text === last && !running ? stable + 1 : 0
    last = text
    if (stable >= 6) break
  }
  const running = (await chat.getByRole("button", { name: "Stop", exact: true }).count()) > 0
  if (running) await chat.getByRole("button", { name: "Stop", exact: true }).last().click({ force: true })
  const reply = text.slice(text.lastIndexOf(prompt.slice(0, 40)))
  return { ms: Date.now() - t0, docks, timedOut: running, reply: reply.slice(-2500), shot: await shot(`${name}-end`) }
}

/** Browser grants: once on the first ask of a class, always on the next; every other tool family is refused. */
const browserPolicy: Policy = (dock, seen) => {
  if (dock.kind === "browser_sensitive") return "Allow once"
  if (dock.kind !== "browser") return "Reject"
  return seen.some((item) => item.kind === "browser") ? "Allow always" : "Allow once"
}

async function run() {
  const report: Record<string, unknown> = { model: modelId }
  const step = async (name: string, body: () => Promise<object>) => {
    const t0 = Date.now()
    let entry: Record<string, unknown>
    try {
      entry = { ok: true, ...(await body()) }
    } catch (error) {
      entry = { ok: false, error: error instanceof Error ? error.message : String(error) }
      await shot(`${name}-error`).catch(() => undefined)
    }
    entry.ms = Date.now() - t0
    report[name] = entry
    console.log(JSON.stringify({ step: name, ...entry }).slice(0, 4000))
  }

  await step("boot", async () => boot())
  await step("onboarding", async () => {
    await code.click('.activitybar [aria-label*="Kilo"]')
    const chat = await webview("Welcome to Kilo", 60_000)
    await chat.getByText("REVIEW FIRST").click()
    await sleep(1500)
    await sidebarAction("Settings")
    const frame = await webview("Web Tools", 60_000)
    await frame.getByText("Web Tools", { exact: true }).first().click()
    await sleep(2500)
    return { shot: await shot("webtools-initial") }
  })
  await step("status-empty", async () => {
    await stopHub()
    // The hub comes back even when the read fails, so the later steps still have one.
    const empty = await webToolsStatus().finally(() => startHub())
    const emptyShot = await shot("webtools-empty-no-hub")
    const unpaired = await webToolsStatus()
    return {
      noHub: empty.status,
      emptyShot,
      hubUnpaired: unpaired.status,
      hub: (await hubEntries()).map((entry) => ({ paired: entry.paired, browser: entry.browser })),
      unpairedShot: await shot("webtools-hub-unpaired"),
    }
  })
  await step("d2-notice", async () => {
    // Playwright stays the backend; an extension connects to the hub. D2: a one-time notice offers the switch.
    const entry = (await hubEntries())[0]
    const answer = await hubRequest(entry.socket, "pairing.url")
    const cdp = await context.browser().newBrowserCDPSession()
    await cdp.send("Target.createTarget", { newWindow: true, url: answer.url })
    await until(async () => ((await hubEntries())[0]?.paired ? true : undefined), 30_000, "the extension pairs")
    await sleep(10_000)
    const notifications = await code.$$eval(".notifications-toasts .notification-toast", (els: Any[]) =>
      els.map((element) => element.innerText),
    )
    return { notifications, status: (await webToolsStatus()).status, shot: await shot("d2-extension-paired-playwright-backend") }
  })
  await step("backend-extension", async () => {
    const { frame } = await webToolsStatus("Backend")
    const t0 = Date.now()
    await frame.getByRole("radio").nth(1).check()
    await until(async () => ((await fs.readFile(configFile, "utf8")).includes('"extension"') ? true : undefined), 15_000, "write")
    return { writeMs: Date.now() - t0, browser: JSON.parse(await fs.readFile(configFile, "utf8")).browser, shot: await shot("backend-extension") }
  })
  await step("chat-happy", async () => {
    const result = await turn(
      "happy",
      `Open ${ctx.fixture.remote}/ in my browser (use the browser tools) and tell me the widget price.`,
      browserPolicy,
    )
    return {
      ...result,
      triedBrowserOpen: result.reply.includes("browser_open"),
      answered: result.reply.includes("42.17"),
      groups: (await tabState()).groups,
      opener: opened,
    }
  })
  await step("sites-table", async () => {
    const { sites } = await webToolsStatus("Site permissions")
    return { sites, shot: await shot("webtools-sites-after-chat-grants") }
  })
  await step("chat-screenshot", async () => {
    const result = await turn("screenshot", "Now take a screenshot of that same tab with the browser tools and describe it in one sentence.", browserPolicy)
    const chat = await chatFrame()
    return { ...result, images: await chat.locator("img").count() }
  })
  await step("chat-sensitive", async () => {
    await sidebarAction("New Session")
    const result = await turn(
      "sensitive",
      `With the browser tools: navigate to ${ctx.fixture.remote}/login and then use the evaluate tool to return document.title. Report exactly what the tools answered.`,
      browserPolicy,
    )
    return { ...result, falsePageChanged: result.reply.includes("page changed while permission was requested") }
  })
  await step("chat-deny", async () => {
    const result = await turn("deny", "With the browser tools, navigate to https://example.com and tell me its heading.", () => "Reject", 120)
    return result
  })
  await step("stop-all", async () => {
    await sidebarAction("New Session")
    const first = await turn("stop-open", `Call browser.navigate with url ${ctx.fixture.remote}/ and report the page title. One call.`, browserPolicy)
    await panel.bringToFront()
    await openLocalAgentsSettings()
    const before = (await panel.evaluate(() => document.body.innerText)).match(/Connected agents[\s\S]{0,300}/)?.[0]
    await panel.getByRole("button", { name: /Stop all/i }).first().click()
    await sleep(2000)
    const panelShot = await shot("ext-after-stop-all", panel)
    const groups = (await tabState()).groups.map((group: Any) => group.title)
    await code.bringToFront()
    const second = await turn("stop-next", `Call browser.navigate with url ${ctx.fixture.remote}/about and report the result or the exact tool error verbatim.`, browserPolicy)
    return { first: first.reply.slice(-400), before, panelShot, groups, second: second.reply, stoppedText: second.reply.includes("stopped this browser session") }
  })
  await step("unavailable", async () => {
    await panel.bringToFront()
    await setLocalAgents(false)
    await code.bringToFront()
    await sidebarAction("New Session")
    const result = await turn("unavailable", `Call browser.navigate with url ${ctx.fixture.remote}/about and report the result or the exact tool error verbatim. Do not use other tools.`, browserPolicy, 120)
    const notifications = await code.$$eval(".notifications-toasts .notification-toast", (els: Any[]) => els.map((element) => element.innerText))
    return { ...result, notifications, status: (await webToolsStatus()).status, statusShot: await shot("webtools-status-switch-off") }
  })
  await step("reconnect", async () => {
    await panel.bringToFront()
    await setLocalAgents(true)
    const t0 = Date.now()
    await until(async () => ((await hubEntries())[0]?.browser ? true : undefined), 30_000, "the extension reconnects")
    await code.bringToFront()
    return { ms: Date.now() - t0, pairingPagesOpened: opened.length }
  })
  await step("public-url-tool-choice", async () => {
    await sidebarAction("New Session")
    const result = await turn("public-url", "Open https://example.com in my browser and tell me the main heading.", (dock) => (dock.kind === "browser" ? "Allow once" : "Reject"), 120)
    return { ...result, firstDock: result.docks[0]?.kind }
  })
  await step("backend-off", async () => {
    const { frame } = await webToolsStatus("Backend")
    await frame.getByRole("radio").nth(2).check()
    await until(async () => ((await fs.readFile(configFile, "utf8")).includes('"off"') ? true : undefined), 15_000, "write")
    await sidebarAction("New Session")
    const result = await turn("backend-off", `Call browser.navigate with url ${ctx.fixture.local}/about and report the result or the exact error verbatim. Do not use browser_open or curl.`, browserPolicy, 120)
    return { ...result, toolsStillOffered: result.reply.includes("browser.navigate") }
  })
  report.spendAfter = await spend()
  report.shots = shots
  await fs.writeFile(path.join(evidence, "report.json"), JSON.stringify(report, null, 2))
  console.log(`report: ${path.join(evidence, "report.json")}`)
  await app?.close().catch(() => undefined)
  await context?.close().catch(() => undefined)
  await stopHub()
  process.exit(0)
}

if (mode === "serve") await serve()
else if (mode === "run") await run()
else throw new Error(`unknown mode ${mode}`)
