#!/usr/bin/env bun
// Real end-to-end check of the Kilo browser bridge on Firefox: the built Firefox MV3 extension installed into a real
// Firefox (temporary add-on, isolated profile) through WebDriver BiDi, paired over loopback (or connected through
// the native messaging host the CLI installs) with the real CLI (`kilo2 run`, `browser.backend: "extension"`), driven
// by a scripted OpenAI-compatible model. Not a `bun test` file: it needs a display (run it under xvfb), a built CLI
// binary, the built Firefox extension and a Firefox with the remote agent.
//
//   xvfb-run -a bun test/browser/firefox-e2e.ts <kilo2> <scenario>
//
//   E2E_EXTENSION_DIR   the built unpacked Firefox extension (default: ../../../cloud/apps/extension/.output/firefox-mv3)
//   E2E_FIREFOX         the Firefox executable (default: /opt/firefox/firefox)
//   E2E_HOME            the run's home (default: a fresh mkdtemp); the harness creates run-<n> under it
//   E2E_PORT_BASE       first port of the range the hubs and the BiDi endpoint may use (default: 48150, 50 ports)
//   E2E_EVIDENCE        directory for full-display screenshots (`import -window root`); unset: none are taken
//   E2E_FF_TABGROUPS    "1": load a copy of the build with the `tabGroups` permission added (what the Chrome build has)
//   E2E_FF_PROMOTE      comma list of optional permissions to promote to required in a copy (e.g. "nativeMessaging")
//   E2E_REPS            repetitions for the perf scenario (default 20)
//   E2E_FF_CSP          an explicit content_security_policy.extension_pages for a patched copy. Firefox's MV3 default
//                       ("script-src 'self'; upgrade-insecure-requests;") upgrades the hub's ws://127.0.0.1 to wss://,
//                       so the shipped build never connects over loopback; "script-src 'self'" lets the rest run
//   E2E_THINK_MS        model think time after a navigation (default 0: the model answers at once)
//
// Scenarios: setup, navigate-snapshot, permission, frames, sensitive, group, stop, unpaired, parity, dialog, focus,
// perf, native, download.
//
// The product path, in order: Firefox starts with the remote agent on a fresh profile; `webExtension.install` installs
// the unpacked build as a temporary add-on (the same thing about:debugging "Load Temporary Add-on" does); the side
// panel page is opened in a tab and signed in with a fake token (app.kilo.ai answered by a BiDi network intercept); the
// "Allow local agents" switch is clicked with real input (`input.performActions`), so the extension's own
// `permissions.request` runs inside a user gesture. Firefox answers that prompt itself: the profile sets
// `extensions.webextOptionalPermissionPrompts=false`, Firefox's switch for "grant optional permissions without a
// doorhanger" — the state after a user clicks Allow. Then `kilo2 browser hub --loopback`, the hub's `pairing.url`
// RPC over the per-user CLI socket, the pairing page opened in a new Firefox window (the extension redeems the token
// and dials the hub), then `kilo2 run` with a scripted model. The browser-neutral pieces (scripted model, CLI
// environment and runs, hub, fixtures' frame server, small helpers) come from extension-harness.ts.
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import {
  type Call,
  cliConfig,
  cliEnvironment,
  decodePng,
  field,
  FRAME_MARKER,
  type Hub as HarnessHub,
  html,
  pairingUrl,
  pixel,
  type Plan,
  prepareHome,
  readHubEntry,
  PUBLIC_MARKER,
  record,
  refOf,
  runCli,
  type Settings,
  type Step,
  startFrameServer,
  startHub as harnessStartHub,
  startModel,
  tap,
  toolTimes,
  type Rule,
  until,
} from "./extension-harness"

const binaryInput = process.argv[2]
const scenario = process.argv[3] ?? "setup"
if (!binaryInput) throw new Error("usage: bun test/browser/firefox-e2e.ts <kilo2> <scenario>")
const binary = path.resolve(binaryInput)

const extensionDirectory =
  process.env.E2E_EXTENSION_DIR ?? path.resolve(import.meta.dirname, "../../../../cloud/apps/extension/.output/firefox-mv3")
const firefoxPath = process.env.E2E_FIREFOX ?? "/opt/firefox/firefox"
const portBase = Number(process.env.E2E_PORT_BASE ?? "48150")
const evidenceDirectory = process.env.E2E_EVIDENCE
const reps = Number(process.env.E2E_REPS ?? "20")
const thinkMs = Number(process.env.E2E_THINK_MS ?? "0")

/** The Gecko id of the build, and a fixed internal UUID so the harness knows the moz-extension origin up front. */
const GECKO_ID = "browser-agent@kilo.ai"
const EXTENSION_UUID = "5a1f6c1e-7d0b-4a52-9a6e-0f1e2d3c4b5a"
const EXTENSION_ORIGIN = `moz-extension://${EXTENSION_UUID}`

const MARKER = FRAME_MARKER
const PASSWORD_VALUE = "hunter2"

/**
 * The WebExtension APIs the harness evaluates inside the extension's own side-panel page. The CLI package has no
 * extension typings; every result crosses the BiDi boundary as JSON and is validated before the harness reads it.
 */
declare const browser: {
  permissions: { getAll(): Promise<unknown> }
  runtime: { getManifest(): unknown; getBrowserInfo(): Promise<unknown> }
  storage: {
    local: { get(key: string | null): Promise<Record<string, unknown>> }
    session?: { get(key: string | null): Promise<Record<string, unknown>> }
  }
  tabGroups?: { get(id: number): Promise<unknown>; query(query: Record<string, unknown>): Promise<unknown[]> }
  tabs: {
    group?: unknown
    onActivated: { addListener(listener: (info: { tabId: number; windowId: number }) => void): void }
    query(query: Record<string, unknown>): Promise<Record<string, unknown>[]>
  }
}

// ---------------------------------------------------------------------------------------------
// Fixtures: a localhost page, a cross-origin frame on 127.0.0.2, a parity page with one control per tool.
// ---------------------------------------------------------------------------------------------

/** Every value the fixture page reported from its password field. */
const recorded: string[] = []
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
      document.body.style.background = "#00ff00"
    })
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

/** A cross-origin frame inside an open shadow root and a password field inside a closed one; both must be masked. */
const shadowed = (frameOrigin: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Shadow E2E</title></head>
<body style="margin:0;background:#ffffff">
  <div id="open-host" style="position:fixed;left:0;top:0;width:320px;height:200px"></div>
  <div id="closed-host" style="position:fixed;left:0;top:260px;width:300px;height:60px"></div>
  <script>
    document.getElementById("open-host").attachShadow({ mode: "open" }).innerHTML =
      '<iframe src="${frameOrigin}/" style="display:block;width:320px;height:200px;border:0"></iframe>'
    document.getElementById("closed-host").attachShadow({ mode: "closed" }).innerHTML =
      '<input type="password" value="hunter2" style="display:block;box-sizing:border-box;width:300px;height:60px;border:0;padding:0;background:#ff0000">'
  </script>
</body></html>`

const userPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>User tab</title></head>
<body><h1>USER PAGE</h1></body></html>`

/** One control per contract tool; every effect lands in `window.__log` so one evaluate can prove what reached the page. */
const parityPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>Parity</title></head>
<body>
  <h1>Parity</h1>
  <button id="go">Click me</button>
  <p id="status">idle</p>
  <label>Name <input id="name" type="text"></label>
  <label><input id="agree" type="checkbox"> Agree</label>
  <label>Color <select id="color"><option value="red">Red</option><option value="blue">Blue</option></select></label>
  <div id="hover" role="button" tabindex="0" aria-label="Hover me" style="width:140px;height:30px;background:#eee">Hover me</div>
  <div id="src" role="button" draggable="true" aria-label="Drag source" style="width:120px;height:30px;background:#ccf">Drag source</div>
  <div id="dst" role="region" aria-label="Drop zone" style="width:200px;height:60px;background:#cfc">Drop zone</div>
  <label>Upload <input id="file" type="file"></label>
  <button id="alert">Show alert</button>
  <a id="next" href="/page2">Next page</a>
  <script>
    window.__log = []
    const log = (entry) => { window.__log.push(entry) }
    const $ = (id) => document.getElementById(id)
    $("go").addEventListener("click", () => {
      $("status").textContent = "clicked"
      log("click")
      console.log("parity-console-log")
      console.error("parity-console-error")
      fetch("/api/data?from=click").catch(() => undefined)
    })
    $("name").addEventListener("input", () => log("name:" + $("name").value))
    $("agree").addEventListener("change", () => log("agree:" + $("agree").checked))
    $("color").addEventListener("change", () => log("color:" + $("color").value))
    $("hover").addEventListener("mouseover", () => log("hover"))
    $("src").addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/plain", "dragged"); log("dragstart") })
    $("dst").addEventListener("dragover", (event) => event.preventDefault())
    $("dst").addEventListener("drop", (event) => {
      event.preventDefault()
      const files = [...(event.dataTransfer.files || [])].map((file) => file.name)
      log("drop:" + event.dataTransfer.getData("text/plain") + (files.length ? ":files=" + files.join(",") : ""))
    })
    $("file").addEventListener("change", () => log("upload:" + [...$("file").files].map((file) => file.name).join(",")))
    document.addEventListener("keydown", (event) => log("key:" + event.key))
    $("alert").addEventListener("click", () => { const answer = confirm("parity-dialog"); log("dialog:" + answer) })
    document.modelContext = {
      getTools: async () => [{ name: "echo", title: "Echo", description: "Echo the text", origin: location.origin,
        inputSchema: { type: "object", properties: { text: { type: "string" } } } }],
      executeTool: async (tool, args) => { log("webmcp:" + JSON.stringify(args)); return { content: [{ type: "text", text: "echo:" + (args && args.text) }] } },
    }
    fetch("/api/data?from=load").catch(() => undefined)
  </script>
</body></html>`

const pageTwo = `<!doctype html>
<html><head><meta charset="utf-8"><title>Page two</title></head>
<body><h1>PAGE TWO</h1></body></html>`

const downloadPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>Download E2E</title></head>
<body><h1>Download E2E</h1><a id="file" href="/download">Get the report</a></body></html>`

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
      return new Response("report-body", {
        headers: { "content-type": "text/plain", "content-disposition": 'attachment; filename="report.txt"' },
      })
    }
    if (url.pathname === "/api/data") return Response.json({ ok: true, from: url.searchParams.get("from") })
    if (url.pathname === "/user") return html(userPage)
    if (url.pathname === "/all") return html(parityPage)
    if (url.pathname === "/page2") return html(pageTwo)
    if (url.pathname === "/download-page") return html(downloadPage)
    if (url.pathname === "/framed") return html(framed(frame.url.origin))
    if (url.pathname === "/shadow") return html(shadowed(frame.url.origin))
    return html(simple)
  },
})

const frame = startFrameServer()

const publicOrigin = frame.url.origin
const localOrigin = fixture.url.origin

// ---------------------------------------------------------------------------------------------
// Scripted model (extension-harness.ts), with this runner's tool census and think time.
// ---------------------------------------------------------------------------------------------

/** The tool names the CLI declared to the model on its first browser-capable request, and the browser names `execute` documents. */
let declared: { tools: string[]; codeModeBrowser: string[] } | undefined

const model = startModel({
  onRequest: async ({ step, tools: list }) => {
    if (declared === undefined) {
      const execute = list.find((tool) => field(field(tool, "function"), "name") === "execute")
      const description = JSON.stringify(field(execute, "function") ?? "")
      const codeModeBrowser = [...new Set([...description.matchAll(/browser\.([a-z_]+)\(/g)].map((match) => match[1] ?? ""))]
      declared = { codeModeBrowser, tools: step.tools }
    }
    // Model think time after a navigation (E2E_THINK_MS): Firefox's navigate returns before the page loads, so a
    // scripted model that answers in ~1 ms reads the old document; a real model takes longer than that to answer.
    const previous = JSON.stringify(step.calls.at(-1) ?? "")
    if (thinkMs > 0 && /navigate|\\?"action\\?":\\?"new/.test(previous)) await Bun.sleep(thinkMs)
  },
})

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const failures: string[] = []
const notes: string[] = []
function expect(condition: boolean, message: string) {
  if (!condition) failures.push(message)
}

const usedPorts = new Set<number>()
/** A free port inside the assigned range: the VM is shared, so hubs and the BiDi endpoint never leave it. */
async function rangePort(offset = 0): Promise<number> {
  for (let candidate = portBase + offset; candidate < portBase + 50; candidate += 1) {
    if (usedPorts.has(candidate)) continue
    const free = await new Promise<boolean>((resolve) => {
      const server = net.createServer()
      server.once("error", () => resolve(false))
      server.listen(candidate, "127.0.0.1", () => server.close(() => resolve(true)))
    })
    if (free) {
      usedPorts.add(candidate)
      return candidate
    }
  }
  throw new Error(`no free port in ${portBase}-${portBase + 49}`)
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[at] ?? 0
}

/** A full-display capture (tab strip, side panel, groups): what a user would see. No-op without E2E_EVIDENCE. */
async function evidence(name: string): Promise<string | undefined> {
  if (!evidenceDirectory) return undefined
  await fs.mkdir(evidenceDirectory, { recursive: true })
  const file = path.join(evidenceDirectory, `${scenario}-${name}.png`)
  const child = Bun.spawn(["import", "-window", "root", file], { stderr: "pipe", stdout: "ignore" })
  const code = await child.exited
  if (code !== 0) {
    notes.push(`evidence ${name}: import exited ${code}: ${(await new Response(child.stderr as ReadableStream).text()).slice(0, 200)}`)
    return undefined
  }
  return file
}

// ---------------------------------------------------------------------------------------------
// WebDriver BiDi: the one protocol Firefox's remote agent speaks for a new session.
// ---------------------------------------------------------------------------------------------

class Bidi {
  private next = 1
  private pending = new Map<number, { method: string; resolve(value: unknown): void; reject(error: Error): void }>()
  private listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.receive(String(event.data)))
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error(`BiDi closed during ${pending.method}`))
      this.pending.clear()
    })
  }

  static async connect(port: number): Promise<Bidi> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/session`)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true })
      socket.addEventListener("error", () => reject(new Error("BiDi connect failed")), { once: true })
    })
    return new Bidi(socket)
  }

  send(method: string, params: Record<string, unknown> = {}, timeout = 60_000): Promise<Record<string, unknown>> {
    const id = this.next++
    const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>()
    const timer = setTimeout(() => {
      this.pending.delete(id)
      reject(new Error(`BiDi ${method} timed out`))
    }, timeout)
    this.pending.set(id, {
      method,
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
      resolve: (value) => {
        clearTimeout(timer)
        resolve(record(value) ?? {})
      },
    })
    this.socket.send(JSON.stringify({ id, method, params }))
    return promise
  }

  on(event: string, listener: (params: Record<string, unknown>) => void) {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
  }

  close() {
    try {
      this.socket.close()
    } catch {
      // Already closed.
    }
  }

  private receive(text: string) {
    let message: Record<string, unknown> | undefined
    try {
      message = record(JSON.parse(text))
    } catch {
      return
    }
    if (message === undefined) return
    const id = message["id"]
    if (typeof id === "number" && this.pending.has(id)) {
      const pending = this.pending.get(id)
      this.pending.delete(id)
      if (message["type"] === "error") pending?.reject(new Error(`${pending.method}: ${String(message["error"])}: ${String(message["message"])}`))
      else pending?.resolve(message["result"])
      return
    }
    if (message["type"] === "event" && typeof message["method"] === "string") {
      const params = record(message["params"]) ?? {}
      for (const listener of this.listeners.get(message["method"]) ?? []) listener(params)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Firefox: an isolated profile, the remote agent, the add-on installed temporarily, the side panel in a tab.
// ---------------------------------------------------------------------------------------------

let bidi: Bidi
/** The same connection for the teardown, which also runs when launch() failed before connecting. */
let connected: Bidi | undefined
let firefoxChild: { exited: Promise<number>; kill(signal?: number | string): void; pid: number } | undefined
const firefoxLog = { text: "" }
let panelContext = ""
let firefoxVersion = ""
/** The Kilo API calls the side-panel page made and the preload stub answered. */
const intercepted: string[] = []

function userJs(downloads: string, proxyPort: number) {
  const prefs: Record<string, string | number | boolean> = {
    // The internal UUID of the add-on, so the moz-extension origin is known before install.
    "extensions.webextensions.uuids": JSON.stringify({ [GECKO_ID]: EXTENSION_UUID }),
    // Firefox's own switch for "optional permissions are granted without a doorhanger": the state after a user
    // clicks Allow. The extension still has to call permissions.request from a user gesture.
    "extensions.webextOptionalPermissionPrompts": false,
    "xpinstall.signatures.required": false,
    "extensions.autoDisableScopes": 0,
    "browser.shell.checkDefaultBrowser": false,
    "browser.startup.homepage_override.mstone": "ignore",
    "browser.startup.page": 0,
    "browser.aboutwelcome.enabled": false,
    "browser.tabs.warnOnClose": false,
    "datareporting.policy.dataSubmissionEnabled": false,
    "datareporting.healthreport.uploadEnabled": false,
    "toolkit.telemetry.reportingpolicy.firstRun": false,
    "app.update.disabledForTesting": true,
    // Console output of extension pages and the background script goes to stdout: the harness's equivalent of the
    // Chrome service-worker log.
    "devtools.console.stdout.content": true,
    "devtools.console.stdout.chrome": true,
    "browser.download.folderList": 2,
    "browser.download.dir": downloads,
    "browser.download.useDownloadDir": true,
    "browser.download.always_ask_before_handling_new_types": false,
    "browser.download.alwaysOpenPanel": false,
    // The Kilo API is answered by the harness: a PAC sends only app.kilo.ai (production builds) and localhost:3000
    // (campaign builds with VITE_KILO_API_BASE_URL) to its proxy; every other request goes direct. The session's
    // acceptInsecureCerts covers the proxy's self-signed certificate.
    "network.proxy.type": 2,
    "network.proxy.autoconfig_url": `data:text/plain,function FindProxyForURL(url, host) { if (host === "app.kilo.ai" || url.indexOf("http://localhost:3000/") === 0) return "PROXY 127.0.0.1:${proxyPort}"; return "DIRECT"; }`,
    "network.proxy.allow_hijacking_localhost": true,
  }
  return Object.entries(prefs)
    .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
    .join("\n")
}

/**
 * A copy of the build with manifest edits: permissions promoted from optional, permissions added (tabGroups), or an
 * explicit `content_security_policy.extension_pages` (to test Firefox's MV3 default, which carries
 * `upgrade-insecure-requests`).
 */
async function patchedCopy(source: string, target: string, edit: { promote: string[]; add: string[]; csp?: string }) {
  await fs.rm(target, { force: true, recursive: true })
  await fs.cp(source, target, { recursive: true })
  const manifestPath = path.join(target, "manifest.json")
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { optional_permissions?: string[]; permissions?: string[] }
  const optional = (manifest.optional_permissions ?? []).filter((permission) => !edit.promote.includes(permission))
  const permissions = [...new Set([...(manifest.permissions ?? []), ...edit.promote, ...edit.add])]
  const policy = edit.csp === undefined ? {} : { content_security_policy: { extension_pages: edit.csp } }
  await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, optional_permissions: optional, permissions, ...policy }, null, 2))
  return target
}

async function launch(base: string, options: { extension: string; env?: Record<string, string | undefined> }) {
  await fs.access(path.join(options.extension, "manifest.json"))
  if (!existsSync(firefoxPath)) throw new Error(`no Firefox at ${firefoxPath}; set E2E_FIREFOX`)
  const profile = path.join(base, "profile")
  const downloads = path.join(base, "downloads")
  await fs.mkdir(profile, { recursive: true })
  await fs.mkdir(downloads, { recursive: true })
  const proxyPort = await startKiloApi()
  await fs.writeFile(path.join(profile, "user.js"), userJs(downloads, proxyPort))
  const port = await rangePort(40)
  const child = Bun.spawn(
    [firefoxPath, "-profile", profile, "-no-remote", "-new-instance", `--remote-debugging-port=${port}`, "about:blank"],
    {
      // MOZ_REMOTE_ALLOW_SYSTEM_ACCESS lets BiDi navigate to moz-extension pages (what geckodriver's
      // `--allow-system-access` sets); without it Firefox refuses: "Navigation ... is not allowed in this context".
      env: { ...(options.env ?? process.env), MOZ_CRASHREPORTER_DISABLE: "1", MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
      stderr: "pipe",
      stdout: "pipe",
    },
  )
  firefoxChild = child
  tap(child.stdout as ReadableStream<Uint8Array>, firefoxLog, 400_000)
  tap(child.stderr as ReadableStream<Uint8Array>, firefoxLog, 400_000)
  bidi = await until(() => Bidi.connect(port), 60_000, "the Firefox remote agent listens")
  connected = bidi
  const session = await bidi.send("session.new", {
    capabilities: { alwaysMatch: { acceptInsecureCerts: true, unhandledPromptBehavior: { default: "ignore" } } },
  })
  firefoxVersion = `${String(field(field(session, "capabilities"), "browserName"))} ${String(field(field(session, "capabilities"), "browserVersion"))}`
  const installed = await bidi.send("webExtension.install", { extensionData: { path: options.extension, type: "path" } })
  expect(installed["extension"] === GECKO_ID, `webExtension.install returned ${JSON.stringify(installed)}`)
  const tab = await bidi.send("browsingContext.create", { type: "tab" })
  panelContext = String(tab["context"])
  await until(async () => {
    await bidi.send("browsingContext.navigate", { context: panelContext, url: `${EXTENSION_ORIGIN}/sidepanel.html`, wait: "complete" })
    return true
  }, 20_000, "the side panel page loads")
}

/**
 * The Kilo API the side panel validates its session against (the Chrome harness routes the same three endpoints):
 * `/api/user`, `/api/organizations`, `/api/trpc/*`. Firefox reaches it through a PAC proxy: CONNECT app.kilo.ai:443 is
 * tunnelled to a local TLS server with a throwaway self-signed certificate, and a plain proxied request
 * (http://localhost:3000) is tunnelled to a local HTTP server. Neither BiDi network interception nor preload scripts
 * reach moz-extension pages, so the network path is the one place both builds can be answered.
 */
async function startKiloApi(): Promise<number> {
  const respond = (request: Request) => {
    const url = new URL(request.url)
    intercepted.push(`${request.method} ${url.host}${url.pathname}`)
    const cors = {
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-origin": "*",
    }
    if (request.method === "OPTIONS") return new Response(null, { headers: cors, status: 204 })
    const body = url.pathname === "/api/user" ? { google_user_email: "e2e@kilo.ai" } : url.pathname === "/api/organizations" ? { organizations: [] } : {}
    return Response.json(body, { headers: cors })
  }
  const certDirectory = path.join(base, "api-cert")
  await fs.mkdir(certDirectory, { recursive: true })
  const openssl = Bun.spawn(
    ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=app.kilo.ai",
      "-keyout", path.join(certDirectory, "key.pem"), "-out", path.join(certDirectory, "cert.pem")],
    { stderr: "ignore", stdout: "ignore" },
  )
  if ((await openssl.exited) !== 0) throw new Error("openssl could not create the API certificate")
  const secure = Bun.serve({
    fetch: respond,
    hostname: "127.0.0.1",
    port: await rangePort(44),
    tls: { cert: Bun.file(path.join(certDirectory, "cert.pem")), key: Bun.file(path.join(certDirectory, "key.pem")) },
  })
  const plain = Bun.serve({ fetch: respond, hostname: "127.0.0.1", port: await rangePort(44) })
  const proxyPort = await rangePort(44)
  net
    .createServer((client) => {
      client.once("data", (head: Buffer) => {
        const line = head.toString("latin1").split("\r\n")[0] ?? ""
        const tunnel = line.startsWith("CONNECT ")
        const upstream = net.createConnection(tunnel ? Number(secure.port) : Number(plain.port), "127.0.0.1", () => {
          if (tunnel) client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
          else upstream.write(head)
          client.pipe(upstream)
          upstream.pipe(client)
        })
        upstream.on("error", () => client.destroy())
        client.on("error", () => upstream.destroy())
      })
    })
    .listen(proxyPort, "127.0.0.1")
  return proxyPort
}

/** Evaluates `fn(...args)` in a browsing context and returns its JSON result. */
async function inContext<T>(context: string, fn: (...args: never[]) => unknown, ...args: unknown[]): Promise<T> {
  const expression = `(async () => JSON.stringify((await (${fn.toString()})(...${JSON.stringify(args)})) ?? null))()`
  const result = await bidi.send("script.evaluate", { awaitPromise: true, expression, resultOwnership: "none", target: { context } })
  if (result["type"] === "exception") {
    throw new Error(`evaluate: ${String(field(result["exceptionDetails"], "text"))}`)
  }
  const value = field(result["result"], "value")
  return JSON.parse(typeof value === "string" ? value : "null") as T
}

/** The extension's own page: every `browser.*` read the harness makes goes through it. */
const ext = <T>(fn: (...args: never[]) => unknown, ...args: unknown[]) => inContext<T>(panelContext, fn, ...args)

/** How each panel click was delivered: Firefox refuses WebDriver input in privileged (moz-extension) contexts. */
const clickModes: string[] = []

/**
 * A click on a button or switch by its label, always as real input when possible: WebDriver input first; Firefox
 * refuses it for moz-extension pages ("does not support browsing contexts in privileged scope"), so the panel gets
 * an X11 click through xdotool at the element's screen position (`mozInnerScreenX/Y` + its rect), which Firefox
 * treats as a user gesture like any mouse click. Only without xdotool does the element's own `click()` run, which
 * is not a user gesture.
 */
async function clickByLabel(context: string, label: string) {
  if (context === panelContext) {
    await ext(async () => {
      const tabs = browser.tabs as unknown as { getCurrent(): Promise<{ id?: number }>; update(id: number, props: Record<string, unknown>): Promise<unknown> }
      const own = await tabs.getCurrent()
      if (own.id !== undefined) await tabs.update(own.id, { active: true })
      return true
    })
  } else {
    await bidi.send("browsingContext.activate", { context })
  }
  const found = await bidi.send("script.callFunction", {
    arguments: [{ type: "string", value: label }],
    awaitPromise: false,
    functionDeclaration: `(label) => [...document.querySelectorAll('button,[role=switch]')].find((element) => (element.getAttribute('aria-label') ?? '') === label || element.textContent.trim() === label) ?? null`,
    resultOwnership: "root",
    target: { context },
  })
  const node = record(found["result"])
  if (node?.["type"] !== "node" || typeof node["sharedId"] !== "string") throw new Error(`no control labelled ${label}`)
  try {
    await bidi.send("input.performActions", {
      actions: [
        {
          actions: [
            { origin: { element: { sharedId: node["sharedId"] }, type: "element" }, type: "pointerMove", x: 0, y: 0 },
            { button: 0, type: "pointerDown" },
            { button: 0, type: "pointerUp" },
          ],
          id: "mouse",
          parameters: { pointerType: "mouse" },
          type: "pointer",
        },
      ],
      context,
    })
    await bidi.send("input.releaseActions", { context })
    clickModes.push(`${label}: webdriver input`)
  } catch (error) {
    const point = await inContext<{ x: number; y: number } | null>(
      context,
      (wanted: string) => {
        const element = [...document.querySelectorAll("button,[role=switch]")].find(
          (candidate) => (candidate.getAttribute("aria-label") ?? "") === wanted || (candidate.textContent ?? "").trim() === wanted,
        )
        if (element === undefined) return null
        element.scrollIntoView({ block: "center" })
        const rect = element.getBoundingClientRect()
        const screen = window as unknown as { mozInnerScreenX: number; mozInnerScreenY: number }
        return {
          x: Math.round((screen.mozInnerScreenX + rect.x + rect.width / 2) * devicePixelRatio),
          y: Math.round((screen.mozInnerScreenY + rect.y + rect.height / 2) * devicePixelRatio),
        }
      },
      label,
    )
    const xdotool = Bun.which("xdotool")
    if (point && xdotool) {
      const child = Bun.spawn([xdotool, "mousemove", "--sync", String(point.x), String(point.y), "click", "1"], { stderr: "pipe", stdout: "ignore" })
      const code = await child.exited
      clickModes.push(`${label}: xdotool at ${point.x},${point.y} exit ${code}`)
      if (code === 0) return
    }
    await bidi.send("script.callFunction", {
      arguments: [{ sharedId: node["sharedId"] }],
      awaitPromise: false,
      functionDeclaration: "(element) => element.click()",
      target: { context },
    })
    clickModes.push(`${label}: element.click() (${String(error).slice(0, 120)})`)
  }
}

async function attribute(context: string, label: string, name: string): Promise<string | null> {
  return inContext<string | null>(
    context,
    (wanted: string, attr: string) => {
      const element = [...document.querySelectorAll("button,[role=switch]")].find(
        (candidate) => (candidate.getAttribute("aria-label") ?? "") === wanted || (candidate.textContent ?? "").trim() === wanted,
      )
      return element === undefined ? null : element.getAttribute(attr)
    },
    label,
    name,
  )
}

async function permissionsState() {
  return ext<unknown>(() => browser.permissions.getAll())
}

/** Local-agent records in extension storage (settings, status, controllers, pairing notice). */
async function localAgentStorage() {
  return ext<unknown>(async () => {
    const pick = (all: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(all).filter(([key]) => /local|agent|pair/i.test(key) && !/auth/i.test(key)))
    return {
      local: pick(await browser.storage.local.get(null)),
      session: browser.storage.session ? pick(await browser.storage.session.get(null)) : "storage.session unavailable",
    }
  })
}

async function seedAuth() {
  await ext(async () => {
    await (browser.storage.local as unknown as { set(items: Record<string, unknown>): Promise<void> }).set({
      kiloAuth: { token: "token-1", userEmail: "e2e@kilo.ai" },
    })
    return true
  })
}

/** Turns on "Allow local agents" through the extension's settings page, with real input like a signed-in user. */
async function enableLocalAgents() {
  await seedAuth()
  await bidi.send("browsingContext.reload", { context: panelContext, wait: "complete" })
  await until(async () => ((await attribute(panelContext, "Settings", "aria-label")) === "Settings" ? true : undefined), 20_000, "the Settings button").catch(
    async (error: unknown) => {
      const shot = await evidence("no-settings")
      const text = await inContext<string>(panelContext, () => `${location.href}\n${document.body.innerText}`).catch(String)
      throw new Error(`${String(error)}; API calls ${JSON.stringify(intercepted)}; screenshot ${String(shot)}; panel:\n${text.slice(0, 1_500)}`)
    },
  )
  await clickByLabel(panelContext, "Settings")
  await until(
    async () => ((await attribute(panelContext, "Allow local agents", "aria-checked")) === "false" ? true : undefined),
    10_000,
    "the switch starts off",
  )
  const before = await permissionsState()
  await clickByLabel(panelContext, "Allow local agents")
  await until(
    async () => ((await attribute(panelContext, "Allow local agents", "aria-checked")) === "true" ? true : undefined),
    10_000,
    "the switch turns on",
  )
  // The permission wait in the switch is bounded at 2 s; read the grant after it.
  await Bun.sleep(2_500)
  const after = await permissionsState()
  const stored = await localAgentStorage()
  return { permissionsAfter: after, permissionsBefore: before, stored }
}

type TabInfo = { active?: boolean; groupId?: number; id?: number; index?: number; title?: string; url?: string; windowId?: number }
type GroupInfo = { collapsed?: boolean; color?: string; id?: number; title?: string }
type TabState = { groups: GroupInfo[]; hasTabGroups: boolean; tabs: TabInfo[] }

async function tabState(): Promise<TabState> {
  return ext<TabState>(async () => {
    const tabs = await browser.tabs.query({})
    const groups = browser.tabGroups ? await browser.tabGroups.query({}) : []
    return {
      groups: groups.map((group) => {
        const value = group as Record<string, unknown>
        return { collapsed: value["collapsed"], color: value["color"], id: value["id"], title: value["title"] }
      }),
      hasTabGroups: browser.tabGroups !== undefined,
      tabs: tabs.map((tab) => ({
        active: tab["active"],
        groupId: tab["groupId"],
        id: tab["id"],
        index: tab["index"],
        title: tab["title"],
        url: tab["url"],
        windowId: tab["windowId"],
      })),
    }
  })
}

/** A tab the user opened before the run (no opener), made the active tab of its window. */
async function openUserTab(url: string): Promise<{ context: string; tabId: number }> {
  const created = await bidi.send("browsingContext.create", { type: "tab" })
  const context = String(created["context"])
  await bidi.send("browsingContext.navigate", { context, url, wait: "complete" })
  await bidi.send("browsingContext.activate", { context })
  const tabId = await until(async () => (await tabState()).tabs.find((tab) => tab.url === url)?.id, 10_000, "the user tab appears")
  return { context, tabId }
}

// ---------------------------------------------------------------------------------------------
// Hub: start `kilo2 browser hub --loopback`, ask it for a pairing URL over its CLI socket, open that page.
// ---------------------------------------------------------------------------------------------

type Hub = HarnessHub

/** The CLI environment for one home: no extra extension ids (the Firefox build's Gecko id is the built-in one). */
const environment = (root: string, settings: Settings) => cliEnvironment(root, undefined, cliConfig(settings, model.origin), settings.env)

/** The harness's hub on a port from this runner's range, released when the hub stops. */
async function startHub(root: string, settings: Settings): Promise<Hub> {
  const hub = await harnessStartHub(binary, root, environment(root, settings), () => rangePort())
  return {
    ...hub,
    stop: async () => {
      await hub.stop()
      usedPorts.delete(hub.port)
    },
  }
}

let lastPairingMs: number | undefined

/** The CLI's pairing step: ask the hub for its one-time URL and open the page in a new Firefox window. */
async function pair(hub: Hub) {
  const started = Date.now()
  const url = await pairingUrl(hub)
  const created = await bidi.send("browsingContext.create", { type: "window" })
  // The extension observes the navigation, redeems the token and closes the tab; the navigation may never "complete".
  const navigated = await bidi
    .send("browsingContext.navigate", { context: String(created["context"]), url, wait: "none" })
    .then(() => "ok")
    .catch((error: unknown) => String(error))
  await until(async () => {
    const current = await hub.entry()
    return current?.paired === true ? current : undefined
  }, 30_000, "the extension pairs and connects").catch(async (error: unknown) => {
    const shot = await evidence("pairing-failed")
    const wsUrl = decodeURIComponent(/ws=([^&]+)/.exec(url)?.[1] ?? "")
    // The same WebSocket the background dials, opened from the extension's own page while the hub still runs.
    const probe = await ext<unknown>(
      (target: string) =>
        new Promise((resolve) => {
          const started = Date.now()
          const socket = new WebSocket(target)
          const timer = setTimeout(() => resolve({ outcome: "timeout", ms: Date.now() - started, readyState: socket.readyState }), 5_000)
          socket.addEventListener("open", () => {
            clearTimeout(timer)
            socket.close()
            resolve({ outcome: "open", ms: Date.now() - started })
          })
          socket.addEventListener("close", (event) => {
            clearTimeout(timer)
            resolve({ code: event.code, outcome: "close", ms: Date.now() - started, reason: event.reason })
          })
        }),
      wsUrl,
    ).catch(String)
    await Bun.sleep(300)
    const diagnostics = {
      hubLog: hub.log.text.slice(-2_000),
      probe,
      navigated,
      shot,
      storage: await localAgentStorage().catch(String),
      tabs: (await tabState().catch(() => undefined))?.tabs,
      url: url.replace(/t=[^&]+/, "t=<token>"),
    }
    throw new Error(`${String(error)}\n${JSON.stringify(diagnostics, null, 2)}`)
  })
  lastPairingMs = Date.now() - started
  return url
}

// ---------------------------------------------------------------------------------------------
// CLI runs: a fresh home, a fresh hub, the scripted model, and `kilo2 run`.
// ---------------------------------------------------------------------------------------------

let runCounter = 0
let base = ""

type Run = { code: number; hub?: Hub; last: Step; pngs: string[]; root: string; stderr: string; steps: Step[]; stdout: string }
type RunOptions = { pair?: boolean; root?: string; hub?: boolean }

async function run(plan: Plan, settings: Settings, options: RunOptions = {}): Promise<Run> {
  runCounter += 1
  const root = options.root ?? path.join(base, `run-${runCounter}`)
  await prepareHome(root)
  const hub = options.hub === false ? undefined : await startHub(root, settings)
  try {
    if (hub && options.pair !== false) await pair(hub)
    const result = await runCli({ binary, env: environment(root, settings), model, plan, root, timeout: 480_000 })
    // The CLI's event stream and stderr stay next to the run for inspection (tool metadata, needs, timings).
    await fs.writeFile(path.join(root, "run.stdout.jsonl"), result.stdout)
    await fs.writeFile(path.join(root, "run.stderr.log"), result.stderr)
    if (hub) await fs.writeFile(path.join(root, "hub.log"), hub.log.text)
    const { code, last, pngs, stderr, steps, stdout } = result
    return { code, last, pngs, root, stderr, steps, stdout, ...(hub ? { hub } : {}) }
  } finally {
    await hub?.stop()
  }
}

async function savePng(name: string, dataUrl: string | undefined) {
  if (!evidenceDirectory || !dataUrl) return undefined
  await fs.mkdir(evidenceDirectory, { recursive: true })
  const file = path.join(evidenceDirectory, `${scenario}-${name}.png`)
  await fs.writeFile(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"))
  return file
}

function report(results: Record<string, unknown>) {
  return {
    declared,
    extension: extensionDirectory,
    failures,
    firefox: firefoxVersion,
    firefoxLog: firefoxLog.text
      .split("\n")
      .filter((line) => /console|error|warn|kilo|local|agent|bridge|JavaScript/i.test(line))
      .slice(-150),
    clickModes,
    intercepted: [...new Set(intercepted)].slice(0, 20),
    notes,
    pairingMs: lastPairingMs,
    scenario,
    ...results,
  }
}

// ---------------------------------------------------------------------------------------------
// Scenarios (the Chrome harness's set, adapted) and the Firefox-only measurements.
// ---------------------------------------------------------------------------------------------

const clickRef = (snapshot: string) => refOf(snapshot, /button "Click me" \[ref=([^\]]+)\]/)

async function setup() {
  const info = await ext<unknown>(async () => ({
    browserInfo: await browser.runtime.getBrowserInfo(),
    hasTabGroups: browser.tabGroups !== undefined,
    hasTabsGroup: typeof browser.tabs.group === "function",
    manifestPermissions: (browser.runtime.getManifest() as Record<string, unknown>)["permissions"],
  }))
  const shot = await evidence("settings-on")
  return { enabled: enableResult, info, shot }
}

async function navigateSnapshot() {
  const plan: Plan = (step) => {
    if (step.results.length === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      const ref = clickRef(step.results[1] ?? "")
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
  expect(clicked.includes("clicked") || after.includes("clicked"), `the click did not change the page:\n${clicked.slice(0, 500)}\n---\n${after.slice(0, 500)}`)
  expect(result.code === 0, `run exited ${result.code}\n${result.stderr.slice(-1_500)}`)
  const shot = await evidence("after-run")
  return {
    hubLog: result.hub?.log.text.slice(-2_000),
    results: results.map((value) => value.slice(0, 500)),
    run: { code: result.code, stderr: result.stderr.slice(-2_000) },
    shot,
    tabs: await tabState(),
  }
}

async function permission() {
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
  return { allowed: { navigated: navigated.slice(0, 400), snapshot: snapshot.slice(0, 500) }, refused: refusedResult.slice(0, 500) }
}

async function frames() {
  const buttonRef = (snapshot: string) => clickRef(snapshot)
  const withheld = await run((step) => {
    if (step.results.length === 0) return { args: { url: `${localOrigin}/framed` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      const ref = buttonRef(step.results[1] ?? "")
      return ref ? { args: { element: "the Click me button", target: ref }, name: "browser_click" } : undefined
    }
    if (step.results.length === 3) return { args: { scale: "css", type: "png" }, name: "browser_take_screenshot" }
    if (step.results.length === 4) return { args: { scale: "device", type: "png" }, name: "browser_take_screenshot" }
    return undefined
  }, {})
  const snapshot = withheld.last.results[1] ?? ""
  const clicked = withheld.last.results[2] ?? ""
  const cssImage = decodePng(withheld.pngs[0] ?? withheld.last.images[0])
  const deviceImage = decodePng(withheld.pngs[1] ?? withheld.last.images[1])
  await savePng("withheld-css", withheld.pngs[0] ?? withheld.last.images[0])
  const maskedCss = pixel(cssImage, 160, 100)
  const maskedDevice = pixel(deviceImage, 160, 100)
  const outsideCss = pixel(cssImage, 340, 100)
  expect(snapshot.includes(`[origin withheld: ${publicOrigin}]`), `the snapshot did not withhold the frame:\n${snapshot.slice(0, 600)}`)
  expect(!snapshot.includes(MARKER), `the withheld frame's marker reached the snapshot:\n${snapshot.slice(0, 600)}`)
  expect(clicked.length > 0, "the click before the framed screenshot did not run")
  expect(cssImage !== undefined, `no css screenshot came back: ${(withheld.last.results[3] ?? "").slice(0, 400)}`)
  expect(
    maskedCss !== undefined && maskedCss.every((value) => (value ?? 255) < 40) && maskedDevice !== undefined && maskedDevice.every((value) => (value ?? 255) < 40),
    `the iframe center is not masked in both scales: css=${JSON.stringify(maskedCss)} device=${JSON.stringify(maskedDevice)}`,
  )
  expect(outsideCss !== undefined && outsideCss.some((value) => (value ?? 0) > 60), `the pixel outside the iframe is black: ${JSON.stringify(outsideCss)}`)

  const rules: Rule[] = [{ action: "browser", effect: "allow", resource: `read:${publicOrigin}` }]
  const allowed = await run((step) => {
    if (step.results.length === 0) return { args: { url: `${localOrigin}/framed` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 2) {
      const ref = refOf(step.results[1] ?? "", /iframe \[ref=([^\]]+)\]/)
      return ref ? { args: { target: ref }, name: "browser_snapshot" } : undefined
    }
    if (step.results.length === 3) return { args: {}, name: "browser_snapshot" }
    if (step.results.length === 4) return { args: { scale: "css", type: "png" }, name: "browser_take_screenshot" }
    return undefined
  }, { rules })
  const granted = allowed.last.results[3] ?? ""
  const grantedCss = decodePng(allowed.pngs[0] ?? allowed.last.images[0])
  await savePng("granted-css", allowed.pngs[0] ?? allowed.last.images[0])
  const revealedCss = pixel(grantedCss, 160, 100)
  expect(granted.includes(MARKER), `the granted frame's marker is missing:\n${granted.slice(0, 600)}`)
  expect(
    revealedCss !== undefined && (revealedCss[0] ?? 0) > 200 && (revealedCss[1] ?? 255) < 80 && (revealedCss[2] ?? 255) < 80,
    `the granted frame is not visible in the screenshot: css=${JSON.stringify(revealedCss)}`,
  )

  // Shadow DOM: a cross-origin frame in an open root and a password field in a closed root, no grants.
  const shadow = await run((step) => {
    if (step.results.length === 0) return { args: { url: `${localOrigin}/shadow` }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: { scale: "css", type: "png" }, name: "browser_take_screenshot" }
    return undefined
  }, {})
  const shadowImage = decodePng(shadow.pngs[0] ?? shadow.last.images[0])
  await savePng("shadow-css", shadow.pngs[0] ?? shadow.last.images[0])
  const shadowFrame = pixel(shadowImage, 160, 100)
  const shadowPassword = pixel(shadowImage, 250, 290)
  const shadowOutside = pixel(shadowImage, 500, 400)
  const black = (value: (number | undefined)[] | undefined) => value !== undefined && value.every((channel) => (channel ?? 255) < 40)
  expect(shadowImage !== undefined, `no shadow screenshot came back: ${(shadow.last.results[1] ?? "").slice(0, 400)}`)
  expect(black(shadowFrame), `the frame in the open shadow root is not masked: ${JSON.stringify(shadowFrame)}`)
  expect(black(shadowPassword), `the password field in the closed shadow root is not masked: ${JSON.stringify(shadowPassword)}`)
  expect(shadowOutside !== undefined && shadowOutside.some((value) => (value ?? 0) > 60), `the pixel outside the shadow hosts is black: ${JSON.stringify(shadowOutside)}`)
  return {
    granted: granted.slice(0, 600),
    maskedCss,
    maskedDevice,
    outsideCss,
    revealedCss,
    results: withheld.last.results.map((value) => value.slice(0, 500)),
    shadow: { frame: shadowFrame, outside: shadowOutside, password: shadowPassword },
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
      const ref = clickRef(step.results[1] ?? "")
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
  await until(() => (recorded.includes(PASSWORD_VALUE) ? true : undefined), 5_000, "the fixture records the allowed fill").catch(() => undefined)
  expect(recorded.includes(PASSWORD_VALUE), `the fixture did not record the allowed fill: ${JSON.stringify(recorded)} / ${(allowed.last.results[3] ?? "").slice(0, 300)}`)
  return { allowed: (allowed.last.results[3] ?? "").slice(0, 400), recorded: [...recorded], refused: typed.slice(0, 500) }
}

/**
 * The index `browser_tabs list` reported for the first tab whose url contains `needle`. The checked tab path answers
 * `{"tabs":[{index,url,…}]}` and withholds tabs outside the session as `[origin withheld]` (`withheld` picks the first
 * of those when no url matches); the old Firefox path printed `N: title - url` lines.
 */
function listedIndex(listed: string, needle: string, withheld = false): number | undefined {
  const array = /"tabs"\s*:\s*(\[[\s\S]*?\])/.exec(listed)
  if (array) {
    let tabs: unknown[] = []
    try {
      tabs = JSON.parse(array[1] ?? "[]") as unknown[]
    } catch {
      tabs = []
    }
    const match =
      tabs.find((tab) => String(field(tab, "url") ?? "").includes(needle)) ??
      (withheld ? tabs.find((tab) => field(tab, "url") === "[origin withheld]") : undefined)
    const index = field(match, "index")
    return typeof index === "number" ? index : undefined
  }
  const line = listed.split("\n").find((entry) => /^\d+: /.test(entry) && entry.includes(needle))
  return line === undefined ? undefined : Number(line.slice(0, line.indexOf(":")))
}

async function group() {
  const userUrl = `${localOrigin}/user`
  const user = await openUserTab(userUrl)
  const userBefore = (await tabState()).tabs.find((tab) => tab.id === user.tabId)
  let during: TabState | undefined
  let afterUserSelect: TabState | undefined
  let afterBlankSelect: TabState | undefined
  let shot: string | undefined
  const result = await run((step) => {
    const index = step.results.length
    if (index === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
    if (index === 1) return { args: {}, name: "browser_snapshot" }
    if (index === 2) return { args: { action: "list" }, name: "browser_tabs" }
    if (index === 3) {
      return (async () => {
        during = await tabState()
        shot = await evidence("during")
        // The user's own tab (D9: a session may not select it).
        return { args: { action: "select", index: listedIndex(step.results[2] ?? "", userUrl, true) ?? -1 }, name: "browser_tabs" }
      })()
    }
    if (index === 4) {
      return (async () => {
        afterUserSelect = await tabState()
        // The window's first tab, which Firefox opened before the run and no session was given (listed only where the
        // tab list shows non-web tabs).
        const blank = listedIndex(step.results[2] ?? "", "about:blank")
        return blank === undefined
          ? { args: { action: "list" }, name: "browser_tabs" }
          : { args: { action: "select", index: blank }, name: "browser_tabs" }
      })()
    }
    if (index === 5) {
      return (async () => {
        afterBlankSelect = await tabState()
        return { args: { url: `${localOrigin}/?after-select=1` }, name: "browser_navigate" }
      })()
    }
    // Closing the user's tab: the destructive end of D9. The fixture tab is the harness's own.
    if (index === 6) return { args: { action: "close", index: listedIndex(step.results[2] ?? "", userUrl, true) ?? -1 }, name: "browser_tabs" }
    return undefined
  }, {})
  during ??= await tabState()
  const after = await tabState()
  const userAfter = after.tabs.find((tab) => tab.id === user.tabId)
  const userDuring = during.tabs.find((tab) => tab.id === user.tabId)
  const kiloGroup = during.groups.find((candidate) => typeof candidate.title === "string" && candidate.title.startsWith("Kilo · ") && candidate.title !== "Kilo · ended")
  const agentTab = during.tabs.find((tab) => tab.url?.startsWith(localOrigin) && tab.id !== user.tabId && !tab.url.includes("/user"))
  const refused = result.last.results[3] ?? ""
  const blankTabId = during.tabs.find((tab) => tab.url === "about:blank")?.id
  const blankSelected = result.last.results[4] ?? ""
  const closed = result.last.results[6] ?? ""
  expect(userAfter?.url === userUrl, `the user tab was navigated or closed: ${JSON.stringify(userAfter)} (close answered: ${closed.slice(0, 200)})`)
  expect(userDuring?.groupId === undefined || userDuring.groupId === -1, `the user tab entered a group: ${JSON.stringify(userDuring)}`)
  expect(agentTab !== undefined, `the agent has no tab of its own: ${JSON.stringify(during.tabs)}`)
  expect(agentTab?.active !== true, `the agent's tab took the foreground: ${JSON.stringify(agentTab)}`)
  expect(refused.includes("not in the agent session"), `selecting the user's tab was not refused:\n${refused.slice(0, 500)}`)
  const blankListed = listedIndex(result.last.results[2] ?? "", "about:blank") !== undefined
  expect(!blankListed || blankSelected.includes("not in the agent session"), `selecting the window's first (non-session) tab was not refused:\n${blankSelected.slice(0, 500)}`)
  expect(
    during.tabs.find((tab) => tab.id === user.tabId)?.active === true && afterUserSelect?.tabs.find((tab) => tab.id === user.tabId)?.active === true,
    `the agent's select moved the user's foreground: ${JSON.stringify(afterUserSelect?.tabs.filter((tab) => tab.active))}`,
  )
  expect(
    after.tabs.find((tab) => tab.id === blankTabId)?.url === "about:blank",
    `the navigate after the select changed a non-session tab: ${JSON.stringify(after.tabs)}`,
  )
  expect(!during.hasTabGroups || kiloGroup !== undefined, `tabGroups exists but no live "Kilo · …" group: ${JSON.stringify(during.groups)}`)
  if (!during.hasTabGroups) notes.push("browser.tabGroups is undefined in this build: no session group on Firefox")
  return {
    agentTab,
    group: kiloGroup,
    hasTabGroups: during.hasTabGroups,
    listed: (result.last.results[2] ?? "").slice(0, 800),
    refused: refused.slice(0, 400),
    blankSelected: blankSelected.slice(0, 400),
    afterSelectNavigate: (result.last.results[5] ?? "").slice(0, 400),
    closeUserTab: closed.slice(0, 400),
    userTabAfter: userAfter ?? "gone",
    activeAfterUserSelect: afterUserSelect?.tabs.filter((tab) => tab.active).map((tab) => ({ id: tab.id, url: tab.url })),
    activeAfterBlankSelect: afterBlankSelect?.tabs.filter((tab) => tab.active).map((tab) => ({ id: tab.id, url: tab.url })),
    tabsAfter: after.tabs,
    shot,
    tabs: during.tabs,
    groups: during.groups,
    userBefore,
    userTabId: user.tabId,
  }
}

async function stop() {
  let stopError: unknown
  let before: TabState | undefined
  let afterStop: TabState | undefined
  const shots: (string | undefined)[] = []
  const result = await run(
    (step) => {
      if (step.results.length === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
      if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
      if (step.results.length === 2) {
        return (async () => {
          try {
            before = await tabState()
            shots.push(await evidence("before-stop"))
            await until(async () => ((await attribute(panelContext, "Stop all", "type")) === "button" ? true : undefined), 20_000, "Stop all shows")
            await clickByLabel(panelContext, "Stop all")
            await Bun.sleep(1_000)
            afterStop = await tabState()
            shots.push(await evidence("after-stop"))
          } catch (error) {
            stopError = error
          }
          const next: Call = { args: { url: `${localOrigin}/?after-stop=1` }, name: "browser_navigate" }
          return next
        })()
      }
      return undefined
    },
    {},
  )
  const next = result.last.results[2] ?? ""
  const ended = afterStop?.groups.find((candidate) => candidate.title === "Kilo · ended")
  expect(stopError === undefined, `Stop all did not run: ${String(stopError)}`)
  expect(next.includes("The user stopped this browser session"), `the next call was not user_stopped:\n${next.slice(0, 600)}`)
  expect(!afterStop?.hasTabGroups || ended !== undefined, `tabGroups exists but no "Kilo · ended" group: ${JSON.stringify(afterStop?.groups)}`)
  return { before, after: afterStop, ended, next: next.slice(0, 600), shots, storage: await localAgentStorage() }
}

async function unpaired() {
  const result = await run(
    (step) => (step.results.length === 0 ? { args: { url: localOrigin }, name: "browser_navigate" } : undefined),
    {},
    { pair: false },
  )
  const reply = result.last.results[0] ?? ""
  const output = `${result.stdout}\n${result.stderr}`
  const hint = "Install the Kilo browser extension and turn on"
  expect(reply.includes("The browser is not available right now"), `the CLI did not get browser_unavailable:\n${reply.slice(0, 500)}`)
  expect(reply.includes(hint), `the setup step is not model-visible:\n${reply.slice(0, 800)}`)
  expect(output.includes(hint), `the setup step is missing from the CLI output:\n${output.slice(-2_000)}`)
  return { reply: reply.slice(0, 600), run: { code: result.code } }
}

/** Every contract tool once, against one page; each effect is read back from the page's own log. */
async function parity() {
  const uploadFile = path.join(base, "upload.txt")
  await fs.writeFile(uploadFile, "upload-body")
  const order: { args: (snapshot: string, results: string[]) => unknown; name: string }[] = []
  const ref = (snapshot: string, pattern: RegExp, fallback: string) => refOf(snapshot, pattern) ?? fallback
  const add = (name: string, args: (snapshot: string, results: string[]) => unknown) => order.push({ args, name })
  add("browser_navigate", () => ({ url: `${localOrigin}/all` }))
  add("browser_snapshot", () => ({}))
  add("browser_find", () => ({ text: "Click me" }))
  add("browser_click", (s) => ({ element: "Click me", target: ref(s, /button "Click me" \[ref=([^\]]+)\]/, "#go") }))
  add("browser_type", (s) => ({ element: "Name", target: ref(s, /textbox "Name" \[ref=([^\]]+)\]/, "#name"), text: "Ada" }))
  add("browser_fill_form", (s) => ({
    fields: [
      { name: "Name", target: ref(s, /textbox "Name" \[ref=([^\]]+)\]/, "#name"), type: "textbox", value: "Grace" },
      { name: "Agree", target: ref(s, /checkbox "Agree" \[ref=([^\]]+)\]/, "#agree"), type: "checkbox", value: "true" },
    ],
  }))
  add("browser_select_option", (s) => ({ element: "Color", target: ref(s, /combobox "Color" \[ref=([^\]]+)\]/, "#color"), values: ["blue"] }))
  add("browser_hover", (s) => ({ element: "Hover me", target: ref(s, /button "Hover me" \[ref=([^\]]+)\]/, "#hover") }))
  add("browser_drag", (s) => ({
    endElement: "Drop zone",
    endTarget: ref(s, /region "Drop zone" \[ref=([^\]]+)\]/, "#dst"),
    startElement: "Drag source",
    startTarget: ref(s, /button "Drag source" \[ref=([^\]]+)\]/, "#src"),
  }))
  add("browser_drop", (s) => ({ data: { "text/plain": "payload" }, element: "Drop zone", target: ref(s, /region "Drop zone" \[ref=([^\]]+)\]/, "#dst") }))
  add("browser_press_key", () => ({ key: "k" }))
  add("browser_wait_for", () => ({ text: "clicked" }))
  add("browser_console_messages", () => ({ level: "info" }))
  add("browser_network_requests", () => ({ static: false }))
  add("browser_network_request", () => ({ index: 1 }))
  add("browser_file_upload", () => ({ paths: [uploadFile] }))
  add("browser_run_code_unsafe", () => ({ code: "async (page) => await page.title()" }))
  add("browser_take_screenshot", () => ({ scale: "css", type: "png" }))
  add("browser_webmcp_list", () => ({}))
  add("browser_webmcp_call", () => ({ name: "echo", params: { text: "hi" } }))
  add("browser_evaluate", () => ({ function: "() => JSON.stringify(window.__log)" }))
  add("browser_handle_dialog", () => ({ accept: true }))
  add("browser_resize", () => ({ height: 700, width: 900 }))
  add("browser_tabs", () => ({ action: "list" }))
  add("browser_tabs", () => ({ action: "new", url: `${localOrigin}/page2` }))
  add("browser_tabs", (_s, results) => {
    const index = listedIndex(results[23] ?? "", "/all") ?? -1
    return { action: "select", index }
  })
  add("browser_navigate", () => ({ url: `${localOrigin}/page2` }))
  add("browser_navigate_back", () => ({}))
  add("browser_snapshot", () => ({}))
  add("browser_close", () => ({}))
  const plan: Plan = (step) => {
    const index = step.results.length
    const entry = order[index]
    if (entry === undefined) return undefined
    // The find (results[2]) ran after the snapshot (results[1]): its refs come first, the snapshot's still resolve.
    const refs = `${step.results[2] ?? ""}\n${step.results[1] ?? ""}`
    return { args: entry.args(refs, step.results), name: entry.name }
  }
  const result = await run(plan, { allowSensitive: true })
  const texts = result.last.results
  const times = toolTimes(result.stdout)
  await savePng("screenshot", result.pngs[0] ?? result.last.images[0])
  const rows = order.map((entry, index) => {
    const text = texts[index] ?? "(no result)"
    const unsupported = /unsupported in this browser|not available in Firefox/i.test(text)
    return {
      index,
      ms: times[index] === undefined ? undefined : Math.round((times[index]?.end ?? 0) - (times[index]?.start ?? 0)),
      text: text.slice(0, 700),
      tool: entry.name,
      unsupported,
    }
  })
  const shot = await evidence("after-parity")
  return { code: result.code, png: result.pngs.length, rows, shot, stderr: result.stderr.slice(-1_000), tabs: await tabState() }
}

/** A page dialog on Firefox: the click that opens a confirm(), then handle_dialog, then a snapshot. */
async function dialog() {
  const plan: Plan = (step) => {
    const index = step.results.length
    if (index === 0) return { args: { url: `${localOrigin}/all` }, name: "browser_navigate" }
    if (index === 1) return { args: {}, name: "browser_snapshot" }
    if (index === 2) {
      const target = refOf(step.results[1] ?? "", /button "Show alert" \[ref=([^\]]+)\]/) ?? "#alert"
      return { args: { element: "Show alert", target }, name: "browser_click" }
    }
    if (index === 3) return { args: { accept: true }, name: "browser_handle_dialog" }
    if (index === 4) return { args: {}, name: "browser_snapshot" }
    if (index === 5) return { args: { function: "() => JSON.stringify(window.__log)" }, name: "browser_evaluate" }
    return undefined
  }
  let shot: string | undefined
  const watcher = setTimeout(() => void evidence("dialog-open").then((file) => (shot = file)), 4_000)
  const result = await run(plan, { allowSensitive: true })
  clearTimeout(watcher)
  const times = toolTimes(result.stdout)
  return {
    code: result.code,
    ms: times.map((time) => Math.round(time.end - time.start)),
    shot,
    texts: result.last.results.map((value) => value.slice(0, 500)),
  }
}

/**
 * D9 on Firefox: does an agent screenshot take the user's tab? The user's tab is the active tab; it records every
 * visibility change, and the extension page records every tabs.onActivated. Then the agent navigates (its own inactive
 * tab), snapshots and takes screenshots.
 */
async function focus() {
  const user = await openUserTab(`${localOrigin}/user`)
  await inContext(user.context, () => {
    const target = window as unknown as { __vis: [number, string][] }
    target.__vis = []
    document.addEventListener("visibilitychange", () => target.__vis.push([Date.now(), document.visibilityState]))
    return true
  })
  await ext(() => {
    const target = window as unknown as { __act: [number, number][] }
    target.__act = []
    browser.tabs.onActivated.addListener((info) => target.__act.push([Date.now(), info.tabId]))
    return true
  })
  const shots = 5
  const result = await run((step) => {
    const index = step.results.length
    if (index === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
    if (index === 1) return { args: {}, name: "browser_snapshot" }
    if (index < 2 + shots) return { args: { scale: "css", type: "png" }, name: "browser_take_screenshot" }
    return undefined
  }, {})
  const visibility = await inContext<[number, string][]>(user.context, () => (window as unknown as { __vis: [number, string][] }).__vis)
  const activations = await ext<[number, number][]>(() => (window as unknown as { __act: [number, number][] }).__act)
  const state = await tabState()
  const times = toolTimes(result.stdout)
  const hidden: number[] = []
  for (let index = 0; index < visibility.length; index += 1) {
    const entry = visibility[index]
    const back = visibility[index + 1]
    if (entry?.[1] === "hidden" && back?.[1] === "visible") hidden.push(back[0] - entry[0])
  }
  const agentActivations = activations.filter(([, tabId]) => tabId !== user.tabId).length
  await savePng("agent-screenshot", result.pngs[0] ?? result.last.images[0])
  const image = decodePng(result.pngs[0] ?? result.last.images[0])
  expect(agentActivations === 0, `agent screenshots activated a non-user tab ${agentActivations} times (D9): ${JSON.stringify(activations)}`)
  expect(visibility.length === 0, `the user's tab lost visibility ${hidden.length} times: ${JSON.stringify(visibility)}`)
  return {
    activations,
    agentActivations,
    hiddenMs: hidden,
    image: image === undefined ? undefined : { height: image.height, width: image.width },
    screenshotMs: times.slice(2).map((time) => Math.round(time.end - time.start)),
    texts: result.last.results.map((value) => value.slice(0, 300)),
    userActiveAfter: state.tabs.find((tab) => tab.id === user.tabId)?.active,
    userTabId: user.tabId,
    visibility,
  }
}

/** navigate/snapshot/click/screenshot × reps, then screenshot alone × reps, timed at the CLI tool-event boundary. */
async function perf() {
  const user = await openUserTab(`${localOrigin}/user`)
  await inContext(user.context, () => {
    const target = window as unknown as { __vis: [number, string][] }
    target.__vis = []
    document.addEventListener("visibilitychange", () => target.__vis.push([Date.now(), document.visibilityState]))
    return true
  })
  const sequence = ["browser_navigate", "browser_snapshot", "browser_click", "browser_take_screenshot"]
  const total = reps * 4
  const plan: Plan = (step) => {
    const index = step.results.length
    if (index < total) {
      const phase = index % 4
      if (phase === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
      if (phase === 1) return { args: {}, name: "browser_snapshot" }
      if (phase === 2) return { args: { element: "the button", target: clickRef(step.results[index - 1] ?? "") ?? "#go" }, name: "browser_click" }
      return { args: { scale: "css", type: "png" }, name: "browser_take_screenshot" }
    }
    if (index < total + reps) return { args: { scale: "css", type: "png" }, name: "browser_take_screenshot" }
    return undefined
  }
  const spawned = Date.now()
  const result = await run(plan, {})
  const times = toolTimes(result.stdout)
  const label = (index: number) => (index < total ? sequence[index % 4] ?? "?" : "browser_take_screenshot (alone)")
  const groups = new Map<string, { bytes: number[]; ms: number[] }>()
  times.forEach((time, index) => {
    const key = label(index)
    const entry = groups.get(key) ?? { bytes: [], ms: [] }
    entry.ms.push(time.end - time.start)
    entry.bytes.push(time.bytes)
    groups.set(key, entry)
  })
  const timings = Object.fromEntries(
    [...groups.entries()].map(([key, value]) => [
      key,
      { count: value.ms.length, maxMs: Math.round(Math.max(...value.ms)), medianMs: Math.round(percentile(value.ms, 50)), p95Ms: Math.round(percentile(value.ms, 95)), medianBytes: percentile(value.bytes, 50) },
    ]),
  )
  // Freshness: a screenshot after the click shows the green background the click set.
  const cycleShots = result.pngs.slice(0, reps)
  const fresh = cycleShots.filter((url) => {
    const image = decodePng(url)
    const value = pixel(image, 10, 10)
    return value !== undefined && (value[0] ?? 255) < 60 && (value[1] ?? 0) > 200 && (value[2] ?? 255) < 60
  }).length
  const visibility = await inContext<[number, string][]>(user.context, () => (window as unknown as { __vis: [number, string][] }).__vis)
  const state = await tabState()
  expect(result.code === 0, `perf run exited ${result.code}: ${result.stderr.slice(-800)}`)
  return {
    coldStartMs: times[0] === undefined ? undefined : Math.round(times[0].end - times[0].start),
    firstToolAfterSpawnMs: times[0] === undefined ? undefined : Math.round(times[0].start - spawned),
    freshScreenshots: { fresh, total: cycleShots.length },
    reps,
    timingsMs: timings,
    totalCalls: times.length,
    userActiveAfter: state.tabs.find((tab) => tab.id === user.tabId)?.active,
    userVisibilityChanges: visibility.length,
  }
}

/**
 * Native messaging on Firefox: Firefox runs with the run's HOME, the CLI writes the Firefox host manifest
 * (`kilo2 browser install-host`), the switch is turned on, and `kilo2 run` connects with no loopback hub at all.
 */
async function native(root: string) {
  const settings: Settings = {}
  const install = Bun.spawn([binary, "browser", "install-host"], { cwd: root, env: environment(root, settings), stderr: "pipe", stdout: "pipe" })
  const [installOut, installErr, installCode] = await Promise.all([
    new Response(install.stdout as ReadableStream).text(),
    new Response(install.stderr as ReadableStream).text(),
    install.exited,
  ])
  const manifestFile = path.join(root, ".mozilla", "native-messaging-hosts", "ai.kilo.browser_host.json")
  const manifest = await fs.readFile(manifestFile, "utf8").catch((error: unknown) => `missing: ${String(error)}`)
  const enabled = await enableLocalAgents()
  const connected = await until(async () => {
    const entry = await readHubEntry(root)
    return entry?.paired === true ? entry : undefined
  }, 20_000, "the native hub registers as paired").catch((error: unknown) => String(error))
  const storage = await localAgentStorage()
  const result = await run((step) => {
    if (step.results.length === 0) return { args: { url: localOrigin }, name: "browser_navigate" }
    if (step.results.length === 1) return { args: {}, name: "browser_snapshot" }
    return undefined
  }, settings, { hub: false, root })
  const snapshot = result.last.results[1] ?? ""
  expect(installCode === 0, `install-host exited ${installCode}: ${installErr.slice(-400)}`)
  expect(snapshot.includes('button "Click me"'), `the native run did not snapshot the page:\n${(result.last.results[0] ?? "").slice(0, 400)}\n${snapshot.slice(0, 400)}`)
  return {
    connected,
    enabled,
    install: { code: installCode, out: (installOut + installErr).slice(-600) },
    manifest,
    results: result.last.results.map((value) => value.slice(0, 400)),
    storage,
  }
}

type RuntimeCall = { ms: number; reply: unknown; text: string }

/**
 * One browser tool through the extension's own runtime message (`kilo.tabs.browserTool`), the dispatch the side panel
 * uses and the CLI bridge wraps, as a panel caller: the same tool code a CLI call reaches, without the agent origin
 * gate (which runs only for `agent` callers, browser-runtime.ts). The time is the round trip from the extension page.
 */
async function runtimeTool(tabId: number, tool: string, args: Record<string, unknown>): Promise<RuntimeCall> {
  const message = {
    arguments: args,
    caller: { conversationId: "e2e-conversation", kind: "panel", panelId: "e2e-panel" },
    tabId,
    tool,
    type: "kilo.tabs.browserTool",
  }
  const answer = await ext<{ ms: number; reply: unknown }>(async (body: Record<string, unknown>) => {
    const runtime = browser.runtime as unknown as { sendMessage(message: unknown): Promise<unknown> }
    const started = performance.now()
    const reply = await runtime.sendMessage(body)
    return { ms: performance.now() - started, reply }
  }, message)
  return { ...answer, text: JSON.stringify(answer.reply) }
}

/** A tab of the extension's own making, inactive like an agent's tab, loaded before the first call. */
async function inactiveTab(url: string): Promise<number> {
  const tabId = await ext<number>(async (target: string) => {
    const tabs = browser.tabs as unknown as { create(props: Record<string, unknown>): Promise<{ id: number }> }
    return (await tabs.create({ active: false, url: target })).id
  }, url)
  // Firefox reports a created tab `complete` at its initial about:blank before the real navigation starts, so the
  // document only counts as loaded once the tab shows the requested url too.
  await until(async () => {
    const tab = await ext<{ status?: string; url?: string }>(async (id: number) => {
      const tabs = browser.tabs as unknown as { get(id: number): Promise<{ status?: string; url?: string }> }
      const { status, url } = await tabs.get(id)
      return { status, url }
    }, tabId)
    return tab.status === "complete" && tab.url?.startsWith(url) === true ? true : undefined
  }, 15_000, "the inactive tab loads")
  return tabId
}

async function tabStatus(tabId: number): Promise<string | undefined> {
  return ext<string | undefined>(async (id: number) => {
    const tabs = browser.tabs as unknown as { get(id: number): Promise<{ status?: string; url?: string }> }
    return (await tabs.get(id)).status
  }, tabId)
}

async function recordFocus(userContext: string) {
  await inContext(userContext, () => {
    const target = window as unknown as { __vis: [number, string][] }
    target.__vis = []
    document.addEventListener("visibilitychange", () => target.__vis.push([Date.now(), document.visibilityState]))
    return true
  })
  await ext(() => {
    const target = window as unknown as { __act: [number, number][] }
    target.__act = []
    browser.tabs.onActivated.addListener((info) => target.__act.push([Date.now(), info.tabId]))
    return true
  })
}

async function readFocus(userContext: string) {
  const visibility = await inContext<[number, string][]>(userContext, () => (window as unknown as { __vis: [number, string][] }).__vis.splice(0))
  const activations = await ext<[number, number][]>(() => (window as unknown as { __act: [number, number][] }).__act.splice(0))
  return { activations, visibility }
}

/**
 * Tool parity, D9 and latency inside the extension: every contract tool through the runtime message on an inactive
 * tab while the user's tab is active; five viewport screenshots by each screenshot path while the user's tab records
 * every visibility change; then navigate/snapshot/click/screenshot × reps. This answers what the Firefox runtime can
 * do once a CLI call gets past the agent gate.
 */
async function runtime() {
  const uploadFile = path.join(base, "upload.txt")
  await fs.writeFile(uploadFile, "upload-body")
  const user = await openUserTab(`${localOrigin}/user`)
  await recordFocus(user.context)
  const tabId = await inactiveTab(`${localOrigin}/all`)
  const snapshot = await runtimeTool(tabId, "browser_snapshot", {})
  const s = snapshot.text
  const ref = (pattern: RegExp, fallback: string) => pattern.exec(s)?.[1] ?? fallback
  const go = ref(/button \\?"Click me\\?" \[ref=([^\]\\]+)\]/, "#go")
  const name = ref(/textbox \\?"Name\\?" \[ref=([^\]\\]+)\]/, "#name")
  const agree = ref(/checkbox \\?"Agree\\?" \[ref=([^\]\\]+)\]/, "#agree")
  const color = ref(/combobox \\?"Color\\?" \[ref=([^\]\\]+)\]/, "#color")
  const hover = ref(/button \\?"Hover me\\?" \[ref=([^\]\\]+)\]/, "#hover")
  const src = ref(/button \\?"Drag source\\?" \[ref=([^\]\\]+)\]/, "#src")
  const dst = ref(/region \\?"Drop zone\\?" \[ref=([^\]\\]+)\]/, "#dst")
  const steps: [string, Record<string, unknown>][] = [
    ["browser_find", { text: "Click me" }],
    ["browser_click", { element: "Click me", target: go }],
    ["browser_type", { element: "Name", target: name, text: "Ada" }],
    ["browser_fill_form", { fields: [{ name: "Name", target: name, type: "textbox", value: "Grace" }, { name: "Agree", target: agree, type: "checkbox", value: "true" }] }],
    ["browser_select_option", { element: "Color", target: color, values: ["blue"] }],
    ["browser_hover", { element: "Hover me", target: hover }],
    ["browser_drag", { endElement: "Drop zone", endTarget: dst, startElement: "Drag source", startTarget: src }],
    ["browser_drop", { data: { "text/plain": "payload" }, element: "Drop zone", target: dst }],
    ["browser_press_key", { key: "k" }],
    ["browser_wait_for", { text: "clicked" }],
    ["browser_console_messages", { level: "info" }],
    ["browser_network_requests", { static: false }],
    ["browser_network_request", { index: 1 }],
    ["browser_file_upload", { paths: [uploadFile] }],
    ["browser_run_code_unsafe", { code: "async (page) => await page.title()" }],
    ["browser_take_screenshot", { scale: "css", type: "png" }],
    ["browser_webmcp_list", {}],
    ["browser_webmcp_call", { name: "echo", params: { text: "hi" } }],
    ["browser_evaluate", { function: "() => JSON.stringify(window.__log)" }],
    ["browser_handle_dialog", { accept: true }],
    ["browser_resize", { height: 700, width: 900 }],
    ["browser_tabs", { action: "list" }],
    ["browser_navigate", { url: `${localOrigin}/page2` }],
    ["browser_navigate_back", {}],
    ["browser_snapshot", {}],
    ["browser_tabs", { action: "new", url: `${localOrigin}/page2` }],
    ["browser_close", {}],
  ]
  const rows: { tool: string; ms: number; text: string }[] = [{ ms: Math.round(snapshot.ms), text: s.slice(0, 900), tool: "browser_snapshot" }]
  let screenshotData: string | undefined
  for (const [tool, args] of steps) {
    // Navigation returns before the page loads on Firefox; the next row reads the page once it has.
    const call = await runtimeTool(tabId, tool, args).catch((error: unknown) => ({ ms: -1, reply: undefined, text: `harness: ${String(error)}` }))
    if (tool === "browser_take_screenshot") screenshotData = /data:image\/png;base64,[A-Za-z0-9+/=]+/.exec(call.text)?.[0]
    rows.push({ ms: Math.round(call.ms), text: call.text.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, "<png>").slice(0, 900), tool })
    if (tool === "browser_navigate" || tool === "browser_navigate_back") {
      await until(async () => ((await tabStatus(tabId).catch(() => undefined)) === "complete" ? true : undefined), 10_000, "navigation settles").catch(() => undefined)
    }
  }
  await savePng("runtime-screenshot", screenshotData)
  const toolFocus = await readFocus(user.context)

  // D9: the two screenshot paths on an inactive tab while the user's tab is active.
  const shotTab = await inactiveTab(`${localOrigin}/`)
  await bidi.send("browsingContext.activate", { context: user.context })
  await readFocus(user.context)
  const viewport: { ms: number; ok: string }[] = []
  for (let index = 0; index < 5; index += 1) {
    const answer = await ext<{ ms: number; reply: unknown }>(async (id: number) => {
      const runtime = browser.runtime as unknown as { sendMessage(message: unknown): Promise<unknown> }
      const started = performance.now()
      const reply = await runtime.sendMessage({ tabId: id, type: "kilo.tabs.viewportScreenshot" })
      return { ms: performance.now() - started, reply }
    }, shotTab)
    viewport.push({ ms: Math.round(answer.ms), ok: JSON.stringify(answer.reply).replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, "<png>").slice(0, 200) })
  }
  const viewportFocus = await readFocus(user.context)
  const toolShots: { ms: number; text: string }[] = []
  for (let index = 0; index < 5; index += 1) {
    const call = await runtimeTool(shotTab, "browser_take_screenshot", { scale: "css", type: "png" })
    toolShots.push({ ms: Math.round(call.ms), text: call.text.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, "<png>").slice(0, 200) })
  }
  const toolShotFocus = await readFocus(user.context)
  const userActive = (await tabState()).tabs.find((tab) => tab.id === user.tabId)?.active
  expect(viewportFocus.visibility.length === 0 && toolShotFocus.visibility.length === 0, `screenshots changed the user's tab visibility: viewport=${JSON.stringify(viewportFocus.visibility)} tool=${JSON.stringify(toolShotFocus.visibility)}`)

  // Latency: navigate/snapshot/click/screenshot × reps through the runtime message, user's tab active throughout.
  const latencyTab = await inactiveTab(`${localOrigin}/`)
  const samples: Record<string, number[]> = { navigate: [], navigateToLoad: [], snapshot: [], click: [], screenshot: [] }
  for (let index = 0; index < reps; index += 1) {
    const navigate = await runtimeTool(latencyTab, "browser_navigate", { url: `${localOrigin}/?rep=${index}` })
    const loadStarted = Date.now()
    await until(async () => {
      const status = await ext<{ status?: string; url?: string }>(async (id: number) => {
        const tabs = browser.tabs as unknown as { get(id: number): Promise<{ status?: string; url?: string }> }
        const tab = await tabs.get(id)
        return { status: tab.status, url: tab.url }
      }, latencyTab)
      return status.status === "complete" && status.url?.includes(`rep=${index}`) ? true : undefined
    }, 10_000, `the rep's page loads (navigate answered ${navigate.text.slice(0, 300)})`)
    samples["navigateToLoad"]?.push(navigate.ms + (Date.now() - loadStarted))
    samples["navigate"]?.push(navigate.ms)
    const snap = await runtimeTool(latencyTab, "browser_snapshot", {})
    samples["snapshot"]?.push(snap.ms)
    const target = /button \\?"Click me\\?" \[ref=([^\]\\]+)\]/.exec(snap.text)?.[1] ?? "#go"
    samples["click"]?.push((await runtimeTool(latencyTab, "browser_click", { element: "Click me", target })).ms)
    samples["screenshot"]?.push((await runtimeTool(latencyTab, "browser_take_screenshot", { scale: "css", type: "png" })).ms)
  }
  const latencyFocus = await readFocus(user.context)
  const latency = Object.fromEntries(
    Object.entries(samples).map(([key, values]) => [key, { count: values.length, medianMs: Math.round(percentile(values, 50)), p95Ms: Math.round(percentile(values, 95)) }]),
  )
  return {
    latency,
    latencyFocus: { activations: latencyFocus.activations.length, visibilityChanges: latencyFocus.visibility.length },
    rows,
    screenshots: { toolShotFocus, toolShots, viewport, viewportFocus },
    toolFocus,
    userActiveAfter: userActive,
    userTabId: user.tabId,
  }
}

/**
 * Observation only (the download guard is owned elsewhere): on the real Firefox download pipeline (no WebDriver
 * download behaviour is set), a click on an attachment link, then a navigation straight to the attachment, then the
 * identical navigation again. The folder and the fixture's hit count are read after every call.
 */
async function download() {
  const downloads = path.join(base, "downloads")
  const folder: string[][] = []
  const plan: Plan = async (step) => {
    folder.push(await fs.readdir(downloads).catch(() => [] as string[]))
    const index = step.results.length
    if (index === 0) return { args: { url: `${localOrigin}/download-page` }, name: "browser_navigate" }
    if (index === 1) return { args: {}, name: "browser_snapshot" }
    if (index === 2) return { args: { element: "the report link", target: "#file" }, name: "browser_click" }
    if (index === 3 || index === 4) {
      await Bun.sleep(1_500)
      return { args: { url: `${localOrigin}/download` }, name: "browser_navigate" }
    }
    if (index === 5) await Bun.sleep(2_000)
    return undefined
  }
  const hitsBefore = downloadHits.length
  const result = await run(plan, { allowSensitive: true })
  await Bun.sleep(2_000)
  const files = await fs.readdir(downloads).catch(() => [] as string[])
  return {
    files,
    folder,
    hits: downloadHits.slice(hitsBefore),
    permissions: await permissionsState(),
    tabs: (await tabState()).tabs,
    texts: result.last.results.map((value) => value.slice(0, 500)),
  }
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

let enableResult: unknown
const scenarios: Record<string, () => Promise<Record<string, unknown>>> = {
  dialog,
  download,
  focus,
  frames,
  group,
  "navigate-snapshot": navigateSnapshot,
  parity,
  perf,
  permission,
  runtime,
  sensitive,
  setup,
  stop,
  unpaired,
}

if (!scenarios[scenario] && scenario !== "native") {
  throw new Error(`unknown scenario ${scenario}; choose ${[...Object.keys(scenarios), "native"].join(", ")}`)
}

base = process.env.E2E_HOME ?? (await fs.mkdtemp(path.join(os.tmpdir(), "firefox-e2e-")))
await fs.mkdir(base, { recursive: true })

const promote = (process.env.E2E_FF_PROMOTE ?? "").split(",").map((item) => item.trim()).filter((item) => item.length > 0)
const add = process.env.E2E_FF_TABGROUPS === "1" ? ["tabGroups"] : []
const csp = process.env.E2E_FF_CSP
const manifestEdits = { add, promote, ...(csp === undefined ? {} : { csp }) }
const extension =
  promote.length > 0 || add.length > 0 || csp !== undefined
    ? await patchedCopy(extensionDirectory, path.join(base, "extension-patched"), manifestEdits)
    : extensionDirectory

try {
  if (scenario === "native") {
    const root = path.join(base, "native-home")
    await prepareHome(root)
    await launch(base, { env: environment(root, {}), extension })
    const results = await native(root)
    console.log(JSON.stringify(report({ manifestEdits, ...results }), null, 2))
  } else {
    await launch(base, { extension })
    if (scenario !== "unpaired") enableResult = await enableLocalAgents()
    const selected = scenarios[scenario]
    const results = selected ? await selected() : {}
    console.log(JSON.stringify(report({ enabled: enableResult, manifestEdits, ...results }), null, 2))
  }
  if (failures.length) process.exitCode = 1
} catch (error) {
  failures.push(`harness: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  console.log(JSON.stringify(report({ enabled: enableResult, manifestEdits }), null, 2))
  process.exitCode = 1
} finally {
  try {
    await connected?.send("session.end", {}, 5_000)
  } catch {
    // The session may already be gone.
  }
  connected?.close()
  try {
    firefoxChild?.kill("SIGTERM")
  } catch {
    // Already gone.
  }
  await Promise.race([firefoxChild?.exited, Bun.sleep(5_000)])
  try {
    firefoxChild?.kill("SIGKILL")
  } catch {
    // Already gone.
  }
  fixture.stop(true)
  frame.stop(true)
  model.stop()
}
process.exit(process.exitCode ?? 0)
