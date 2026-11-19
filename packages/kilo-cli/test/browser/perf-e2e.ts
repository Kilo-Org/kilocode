#!/usr/bin/env bun
// Performance harness for the browser bridge: the extension backend against the bundled Playwright backend, on the
// same machine, the same fixture pages and a scripted OpenAI-compatible model. One command runs every area and writes
// a JSON and a markdown report. Not a `bun test` file: it needs a display (xvfb), a built CLI and the built extension.
//
//   bun test/browser/perf-e2e.ts <kilo2> [--reps 20] [--areas tools,cold,large,profile,tabs,concurrent,memory,reconnect]
//                                        [--memory-calls 1000] [--cold-runs 5] [--out <dir>] [--evidence <dir>]
//
//   E2E_EXTENSION_DIR   the built unpacked Chrome MV3 extension (required for the extension backend)
//   E2E_CHROMIUM        the Chromium executable for the extension backend (default: the Chromium that
//                       `kilo2 browser install-chromium` installs for the Playwright backend, so both use one build)
//
// Every latency is a CLI tool-execute event (`tool_use` part, time.start..time.end), so the model round trip is never
// part of it. Areas alternate the backend order (extension first in odd areas, Playwright first in even ones), and
// every area records /proc/loadavg at its start and end: on a shared machine the load hits both backends alike.
import { readdirSync, readFileSync } from "node:fs"
import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"

const binaryInput = process.argv[2]
if (!binaryInput || binaryInput.startsWith("--")) throw new Error("usage: bun perf-e2e.ts <kilo2> [--reps 20] [--areas a,b] [--out dir]")
const binary = path.resolve(binaryInput)
const flag = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`)
  return at > 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1]! : fallback
}
const ALL_AREAS = ["tools", "refs", "cold", "large", "profile", "tabs", "concurrent", "memory", "reconnect"] as const
type Area = (typeof ALL_AREAS)[number]
const reps = Number(flag("reps", "20"))
const memoryCalls = Number(flag("memory-calls", "1000"))
const coldRuns = Number(flag("cold-runs", "5"))
const areas = flag("areas", ALL_AREAS.join(",")).split(",") as Area[]
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const outDir = path.resolve(flag("out", path.join(os.tmpdir(), `perf-report-${stamp}`)))
const evidenceDir = path.resolve(flag("evidence", path.join(outDir, "evidence")))
const extensionDirectory = process.env.E2E_EXTENSION_DIR ?? ""
if (!extensionDirectory) throw new Error("set E2E_EXTENSION_DIR to the built chrome-mv3 extension")

const pluginDirectory = path.resolve(import.meta.dirname, "../../../kilo-plugin")
const playwright: any = await import(Bun.resolveSync("playwright-core", pluginDirectory))

// ---------------------------------------------------------------------------------------------------------------
// Fixture pages: origin A (127.0.0.1) and a cross-origin B (127.0.0.2) serve the same routes.

const html = (title: string, body: string) =>
  `<!doctype html>\n<html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`
const marker = (url: URL) =>
  url.searchParams.has("run") ? `Run ${url.searchParams.get("run")}` : url.searchParams.has("tab") ? `Tab ${url.searchParams.get("tab")}` : "Perf"
const CLICK = `<script>document.getElementById("go").addEventListener("click", () => {
  document.getElementById("status").textContent = "clicked"; document.body.style.background = "#00ff00" })</script>`
const BIG = (() => {
  // 1000 rows of 10 elements each (tr, 5 td, button, a, input, span): a 10k-element DOM.
  const rows: string[] = []
  for (let i = 0; i < 1000; i += 1)
    rows.push(
      `<tr><td>Row ${i}</td><td><button>Act ${i}</button></td><td><a href="#r${i}">Link ${i}</a></td><td><input aria-label="Field ${i}"></td><td><span>${i === 777 ? "Needle 777" : "cell"}</span></td></tr>`,
    )
  return html("Big", `<h1>Big</h1><table>${rows.join("")}</table>`)
})()
const LONG = html(
  "Long",
  Array.from({ length: 100 }, (_, i) => `<div style="height:200px;background:hsl(${(i * 37) % 360},70%,60%)">Band ${i}</div>`).join(""),
)

const servers: { stop(force?: boolean): void }[] = []
const origins = { a: "", b: "" }
function page(url: URL): string {
  const p = url.pathname
  if (p === "/form")
    return html(
      "Form",
      `<h1>Form</h1><button id="go">Click me</button><p id="status">idle</p>
<label>Name <input id="name"></label><label>Email <input id="email"></label>
<label><input type="checkbox" id="agree"> Agree</label><p>Ready</p>${CLICK}`,
    )
  if (p === "/framed")
    return html(
      "Perf framed",
      `<iframe src="${origins.b}/frame?n=0" style="position:fixed;left:0;top:0;width:320px;height:200px;border:0"></iframe>
<h1 style="position:fixed;left:400px;top:0">Perf</h1>`,
    )
  if (p === "/frame") return html(`Frame ${url.searchParams.get("n")}`, `<h2>Frame ${url.searchParams.get("n")}</h2><button>Frame button ${url.searchParams.get("n")}</button>`)
  if (p === "/iframes")
    return html(
      "Iframes",
      `<h1>Iframes</h1>` +
        Array.from({ length: 20 }, (_, i) => `<iframe src="${i % 2 === 0 ? origins.a : origins.b}/frame?n=${i}" style="width:300px;height:150px"></iframe>`).join(""),
    )
  if (p === "/big") return BIG
  if (p === "/long") return LONG
  const name = marker(url)
  return html(`Perf ${name}`, `<h1>${name}</h1><button id="go">Click me</button><p id="status">idle</p>${CLICK}`)
}
for (const [key, hostname] of [["a", "127.0.0.1"], ["b", "127.0.0.2"]] as const) {
  const server = Bun.serve({
    hostname,
    port: 0,
    fetch: (request) => new Response(page(new URL(request.url)), { headers: { "content-type": "text/html; charset=utf-8" } }),
  })
  servers.push(server)
  origins[key] = server.url.origin
}
const A = origins.a

// ---------------------------------------------------------------------------------------------------------------
// The scripted model: one plan per CLI run, addressed by the run id in the base URL path.

type Call = { tool: string; args: unknown }
type Step = { label: string; call: Call; expect?: RegExp; reject?: RegExp; keepImage?: boolean; before?: () => Promise<void> }
type Result = { text: string; bytes: number; imageBytes: number; image?: string }
type Plan = (i: number, results: Result[], steps: Step[]) => Step | undefined
type RunState = { plan: Plan; steps: Step[]; results: Result[]; firstRequestAt?: number; pid?: number }
const runs = new Map<string, RunState>()

const chunk = (model: string, delta: object, finish: string | null) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish, index: 0 }], id: "local", model, object: "chat.completion.chunk" })}\n\n`
let callSeq = 0
const toolCall = (model: string, name: string, args: unknown) =>
  [
    chunk(model, { role: "assistant", tool_calls: [{ function: { arguments: JSON.stringify(args), name }, id: `call_${(callSeq += 1)}`, index: 0, type: "function" }] }, null),
    chunk(model, {}, "tool_calls"),
    "data: [DONE]\n\n",
  ].join("")
const answer = (model: string, text: string) => [chunk(model, { content: text, role: "assistant" }, null), chunk(model, {}, "stop"), "data: [DONE]\n\n"].join("")
const field = (value: unknown, key: string): unknown => (typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined)
const textOf = (content: unknown): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.flatMap((part) => (field(part, "type") === "text" && typeof field(part, "text") === "string" ? [String(field(part, "text"))] : [])).join("\n")
}
const IMAGE = /data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+/g

const sse = (body: string) => new Response(body, { headers: { "content-type": "text/event-stream" } })
const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 0,
  async fetch(request) {
    const match = /^\/run\/([^/]+)\/v1\/chat\/completions$/.exec(new URL(request.url).pathname)
    const state = match ? runs.get(match[1]!) : undefined
    if (!state) return new Response(null, { status: 404 })
    state.firstRequestAt ??= Date.now()
    const body: unknown = await request.json()
    const name = typeof field(body, "model") === "string" ? String(field(body, "model")) : "local"
    const messages = Array.isArray(field(body, "messages")) ? (field(body, "messages") as unknown[]) : []
    const toolResults = messages.filter((message) => field(message, "role") === "tool").length
    // The model-visible output of the previous step: every message after the last assistant turn.
    if (toolResults > state.results.length) {
      let last = -1
      messages.forEach((message, index) => {
        if (field(message, "role") === "assistant") last = index
      })
      const delta = messages.slice(last + 1)
      const json = JSON.stringify(delta)
      const images = json.match(IMAGE) ?? []
      const step = state.steps[state.results.length]
      state.results.push({
        text: delta.map((message) => textOf(field(message, "content"))).join("\n"),
        bytes: json.length,
        imageBytes: images.reduce((sum, image) => sum + image.length, 0),
        ...(step?.keepImage && images[0] ? { image: images[0] } : {}),
      })
    }
    const i = state.results.length
    const step = i < state.steps.length ? state.steps[i] : state.plan(i, state.results, state.steps)
    if (!step) return sse(answer(name, "done"))
    if (i === state.steps.length) {
      state.steps.push(step)
      await step.before?.()
    }
    const declared = field(body, "tools")
    const direct = Array.isArray(declared) && declared.some((tool) => String(field(field(tool, "function"), "name")).startsWith("browser_"))
    return sse(
      direct
        ? toolCall(name, step.call.tool, step.call.args)
        : toolCall(name, "execute", { code: `return await tools.browser.${step.call.tool.slice("browser_".length)}(${JSON.stringify(step.call.args)})` }),
    )
  },
})

// ---------------------------------------------------------------------------------------------------------------
// Measurement helpers.

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? 0
}
const median = (values: number[]) => percentile(values, 50)
const loadavg = () => readFileSync("/proc/loadavg", "utf8").trim()
const nproc = os.availableParallelism()
const kb = (text: string, key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(text)?.[1] ?? 0)

function processTable() {
  const table = new Map<number, { ppid: number; cmd: string }>()
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8")
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1])
      table.set(Number(name), { ppid, cmd: readFileSync(`/proc/${name}/cmdline`, "utf8").replaceAll("\0", " ") })
    } catch {}
  }
  return table
}
function subtree(table: Map<number, { ppid: number; cmd: string }>, root: number, skip?: (pid: number) => boolean): number[] {
  const out: number[] = []
  const queue = [root]
  while (queue.length) {
    const pid = queue.shift()!
    if (!table.has(pid) || skip?.(pid)) continue
    out.push(pid)
    for (const [child, info] of table) if (info.ppid === pid) queue.push(child)
  }
  return out
}
function memoryOf(pids: number[]) {
  let rss = 0
  let pss = 0
  for (const pid of pids)
    try {
      const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8")
      rss += kb(rollup, "Rss")
      pss += kb(rollup, "Pss")
    } catch {}
  return { rssMb: Math.round(rss / 1024), pssMb: Math.round(pss / 1024), processes: pids.length }
}
const isChrome = (table: Map<number, { ppid: number; cmd: string }>) => (pid: number) => /chrom(e|ium)/i.test(table.get(pid)?.cmd.split(" ")[0] ?? "")

type Sample = { label: string; ms: number; start: number; end: number; status: string; ok: boolean; bytes: number; imageBytes: number; text: string }
type RunOutcome = { id: string; backend: Backend; code: number | null; spawnedAt: number; firstRequestAt?: number; exitedAt: number; samples: Sample[]; stderr: string; results: Result[]; steps: Step[] }
type Stat = { n: number; failures: number; median: number; p95: number; min: number; max: number; bytesMedian: number; imageBytesMedian: number; failureSamples: string[] }

// Model-visible failure: a named browser error, a thrown error, or a tool that reports its own failure in text.
const FAILURE = /\b(browser_unavailable|tab_busy|tab_taken|user_stopped|unsupported_in_browser|needs_permission|blocked|origin_changed|protocol_mismatch)\b|Error:|is not available|not connected|unavailable|field\(s\) failed|stale or unknown|is not open/i

function stat(samples: Sample[]): Stat {
  const values = samples.map((sample) => sample.ms)
  const failures = samples.filter((sample) => !sample.ok)
  return {
    n: samples.length,
    failures: failures.length,
    median: median(values),
    p95: percentile(values, 95),
    min: Math.min(...values),
    max: Math.max(...values),
    bytesMedian: median(samples.map((sample) => sample.bytes)),
    imageBytesMedian: median(samples.map((sample) => sample.imageBytes)),
    failureSamples: [...new Set(failures.map((sample) => `${sample.status}: ${sample.text.replace(/\s+/g, " ").slice(0, 240)}`))].slice(0, 3),
  }
}
function byLabel(samples: Sample[]): Record<string, Stat> {
  const groups = new Map<string, Sample[]>()
  for (const sample of samples) groups.set(sample.label, [...(groups.get(sample.label) ?? []), sample])
  return Object.fromEntries([...groups].map(([label, group]) => [label, stat(group)]))
}

// ---------------------------------------------------------------------------------------------------------------
// Backends.

type Backend = "extension" | "playwright"
const base = await fs.mkdtemp(path.join(os.tmpdir(), "perf-bridge-"))
await fs.mkdir(outDir, { recursive: true })
await fs.mkdir(evidenceDir, { recursive: true })

function baseEnv(backend: Backend, extensionId = "") {
  const root = path.join(base, backend)
  return {
    root,
    env: {
      ...process.env,
      HOME: root,
      KILO_API_KEY: "",
      KILO_AUTH_CONTENT: "",
      KILO_BROWSER_DATA_DIR: path.join(base, "browser-data"),
      KILO_BROWSER_EXTRA_EXTENSION_IDS: extensionId,
      KILO_BROWSER_RUN_DIR: path.join(root, "run", "browser"),
      KILO_DISABLE_AUTOUPDATE: "1",
      KILO_DISABLE_MODELS_FETCH: "1",
      PATH: `${path.join(base, "bin")}:${process.env.PATH ?? ""}`,
      XDG_RUNTIME_DIR: path.join(root, "run"),
    } as Record<string, string>,
  }
}
await fs.mkdir(path.join(base, "bin"), { recursive: true })
await fs.writeFile(path.join(base, "bin", "xdg-open"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
for (const backend of ["extension", "playwright"] as const) await fs.mkdir(path.join(base, backend, "run"), { recursive: true, mode: 0o700 })

async function spawnText(argv: string[], env: Record<string, string>, cwd: string) {
  const child = Bun.spawn(argv, { cwd, env, stderr: "pipe", stdout: "pipe", timeout: 600_000 })
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { out, err, code }
}

// The Playwright backend's Chromium, installed once into `<XDG_DATA_HOME>/kilo2/browser/browsers`; every run links
// that directory into its own data home. The extension runs in the same build unless E2E_CHROMIUM says otherwise.
const browsersDir = path.join(base, "xdg-data", "kilo2", "browser", "browsers")
const install = await spawnText([binary, "browser", "install-chromium"], { ...baseEnv("playwright").env, XDG_DATA_HOME: path.join(base, "xdg-data") }, base)
console.error(`install-chromium exit ${install.code}: ${(install.out + install.err).trim().slice(-200)}`)
const installedChrome = (() => {
  for (const file of new Bun.Glob("*/chrome-linux*/chrome").scanSync({ cwd: browsersDir, onlyFiles: true })) return path.join(browsersDir, file)
  return undefined
})()
const chromium = process.env.E2E_CHROMIUM ?? installedChrome ?? playwright.chromium.executablePath()

const cliVersion = (await spawnText([binary, "--version"], baseEnv("playwright").env, base)).out.trim()
const chromiumVersion = (await spawnText([chromium, "--version"], baseEnv("playwright").env, base)).out.trim()

// --- extension: launch, "Allow local agents", hub, loopback pairing ----------------------------------------------
const ext = {
  context: undefined as any,
  id: "",
  panel: undefined as any,
  hub: undefined as any,
  hubLog: "",
  pairingMs: 0,
  profile: path.join(base, "profile"),
  cdp: undefined as any,
}

async function launchExtension() {
  // The accepted-permission state: automation cannot answer Chrome's optional-permission prompt.
  const loaded = path.join(base, "extension")
  await fs.cp(extensionDirectory, loaded, { recursive: true })
  const manifestPath = path.join(loaded, "manifest.json")
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { optional_permissions?: string[]; permissions?: string[] }
  const permissions = [...new Set([...(manifest.permissions ?? []), "downloads"])]
  const optional = (manifest.optional_permissions ?? []).filter((permission) => permission !== "downloads")
  await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, optional_permissions: optional, permissions }, null, 2))
  ext.context = await playwright.chromium.launchPersistentContext(ext.profile, {
    args: [`--disable-extensions-except=${loaded}`, `--load-extension=${loaded}`, "--disable-blink-features=AutomationControlled"],
    executablePath: chromium,
    headless: false,
    ignoreDefaultArgs: ["--enable-automation"],
    // The Playwright backend's default viewport, so screenshots and payloads compare like for like.
    viewport: { height: 720, width: 1280 },
  })
  const worker = ext.context.serviceWorkers()[0] ?? (await ext.context.waitForEvent("serviceworker"))
  ext.id = new URL(worker.url()).host
  ext.cdp = await ext.context.browser().newBrowserCDPSession()
  const ctx = ext.context
  // The signed-in session's endpoints, on the store origin and on the campaign build's VITE_KILO_API_BASE_URL
  // (http://localhost:3000, where another stack may answer 401): the side panel only shows Settings when signed in.
  await ctx.route(
    (url: URL) => (url.origin === "https://app.kilo.ai" || url.origin === "http://localhost:3000") && url.pathname.startsWith("/api/"),
    (route: any) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === "/api/user") return route.fulfill({ json: { google_user_email: "perf@kilo.ai" }, status: 200 })
      if (pathname === "/api/organizations") return route.fulfill({ json: { organizations: [] }, status: 200 })
      return route.fulfill({ json: {}, status: 200 })
    },
  )
  await ctx.addInitScript({ content: "Object.defineProperty(chrome.permissions, 'request', { value: () => Promise.resolve(true) });" })
  const panel = await ctx.newPage()
  await panel.goto(`chrome-extension://${ext.id}/sidepanel.html`)
  await panel.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const api = (globalThis as any).chrome
        api.storage.local.set({ kiloAuth: { token: "token-1", userEmail: "perf@kilo.ai" } }, () => {
          const message = api.runtime?.lastError?.message
          if (message) reject(new Error(message))
          else resolve()
        })
      }),
  )
  await panel.reload()
  await panel
    .getByRole("button", { name: "Settings" })
    .click({ timeout: 20_000 })
    .catch(async (error: unknown) => {
      await panel.screenshot({ path: path.join(evidenceDir, "panel-no-settings.png") }).catch(() => undefined)
      throw new Error(`no Settings button; panel text: ${(await panel.locator("body").innerText().catch(() => "")).slice(0, 600)}`, { cause: error })
    })
  const toggle = panel.getByRole("switch", { name: "Allow local agents" })
  await toggle.waitFor()
  await toggle.click()
  await Bun.sleep(500)
  ext.panel = panel

  const { root, env } = baseEnv("extension", ext.id)
  const port = await freePort()
  const started = Date.now()
  ext.hub = Bun.spawn([binary, "browser", "hub", "--loopback", "--port", String(port)], { cwd: root, env, stderr: "pipe", stdout: "pipe" })
  for (const stream of [ext.hub.stdout, ext.hub.stderr] as ReadableStream<Uint8Array>[])
    void (async () => {
      const decoder = new TextDecoder()
      for await (const value of stream) ext.hubLog += decoder.decode(value, { stream: true })
    })()
  const entry = await poll(() => readEntry(root), 15_000, "hub did not start")
  const pairing = await hubRequest(entry.socket, "pairing.url")
  const cdp = await ext.context.newCDPSession(panel)
  await cdp.send("Target.createTarget", { newWindow: true, url: pairing.url })
  await poll(async () => ((await readEntry(root))?.paired === true ? true : undefined), 30_000, "extension did not pair")
  ext.pairingMs = Date.now() - started
}

async function poll<T>(probe: () => Promise<T | undefined>, timeoutMs: number, error: string): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(error)
    await Bun.sleep(50)
  }
}
async function freePort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>()
  const server = net.createServer()
  server.once("error", reject)
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    resolve(typeof address === "object" && address !== null ? address.port : 0)
    server.close()
  })
  return promise
}
async function readEntry(root: string): Promise<any> {
  const directory = path.join(root, "run", "browser", "hubs")
  for (const file of await fs.readdir(directory).catch(() => [] as string[]))
    if (file.endsWith(".json"))
      try {
        return JSON.parse(await fs.readFile(path.join(directory, file), "utf8"))
      } catch {}
  return undefined
}
async function hubRequest(socketPath: string, method: string): Promise<any> {
  const socket = net.createConnection(socketPath)
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  })
  const { promise, resolve } = Promise.withResolvers<any>()
  let buffer = Buffer.alloc(0)
  socket.on("data", (data: Buffer) => {
    buffer = Buffer.concat([buffer, data])
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0)
      if (buffer.length < 4 + length) return
      const frame = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8"))
      buffer = buffer.subarray(4 + length)
      if (frame?.type === "rpc" && frame.message?.id === 1) {
        socket.end()
        resolve(frame.message.result)
      }
    }
  })
  const body = Buffer.from(JSON.stringify({ type: "rpc", message: { id: 1, jsonrpc: "2.0", method, params: {} } }))
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  socket.write(Buffer.concat([header, body]))
  return promise
}

// --- the extension service worker over CDP -------------------------------------------------------------------
async function swTarget(): Promise<any> {
  const { targetInfos } = await ext.cdp.send("Target.getTargets")
  return targetInfos.find((info: any) => info.type === "service_worker" && String(info.url).includes(ext.id))
}
/** A CDP session on the running extension worker (undefined while it is stopped). */
async function swAttach() {
  const target = await swTarget()
  if (!target) return undefined
  const { sessionId } = await ext.cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: false })
  const pending = new Map<number, (result: any) => void>()
  let next = 0
  const listener = (event: any) => {
    if (event.sessionId !== sessionId) return
    const message = JSON.parse(event.message)
    pending.get(message.id)?.(message.result)
    pending.delete(message.id)
  }
  ext.cdp.on("Target.receivedMessageFromTarget", listener)
  return {
    async send(method: string, params: Record<string, unknown> = {}, timeoutMs = 5_000): Promise<any> {
      const id = (next += 1)
      const { promise, resolve } = Promise.withResolvers<any>()
      pending.set(id, resolve)
      await ext.cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) })
      return await Promise.race([promise, Bun.sleep(timeoutMs).then(() => undefined)])
    },
    async detach() {
      ext.cdp.off("Target.receivedMessageFromTarget", listener)
      await ext.cdp.send("Target.detachFromTarget", { sessionId }).catch(() => undefined)
    },
  }
}
async function swHeapMb(): Promise<number | undefined> {
  const sw = await swAttach()
  if (!sw) return undefined
  await sw.send("HeapProfiler.collectGarbage")
  const usage = await sw.send("Runtime.getHeapUsage")
  await sw.detach()
  return usage ? Math.round((usage.usedSize / 1048576) * 10) / 10 : undefined
}
/** Self time per function of a CPU profile, the heaviest first. */
function topSelf(profile: any, limit = 15) {
  const nodes = new Map<number, any>(profile.nodes.map((node: any) => [node.id, node]))
  const self = new Map<string, number>()
  profile.samples.forEach((id: number, index: number) => {
    const frame = nodes.get(id)?.callFrame
    const key = `${frame?.functionName || "(anonymous)"} ${String(frame?.url ?? "").replace(/^chrome-extension:\/\/[^/]+/, "ext:")}:${(frame?.lineNumber ?? 0) + 1}:${(frame?.columnNumber ?? 0) + 1}`
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000)
  })
  const total = [...self.values()].reduce((sum, value) => sum + value, 0)
  const idle = [...self].filter(([key]) => key.startsWith("(idle)")).reduce((sum, [, value]) => sum + value, 0)
  return {
    totalMs: Math.round(total),
    busyMs: Math.round(total - idle),
    top: [...self].filter(([key]) => !key.startsWith("(idle)")).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, ms]) => ({ fn: key, selfMs: Math.round(ms) })),
  }
}
/** Stops the extension worker; the method that worked and how long until its target was gone. */
async function stopWorker(helper: any): Promise<{ method: string; ms: number; gone: boolean }> {
  const started = Date.now()
  const gone = async (ms: number) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (!(await swTarget())) return true
      await Bun.sleep(50)
    }
    return false
  }
  const session = await ext.context.newCDPSession(helper)
  const versions: any[] = []
  session.on("ServiceWorker.workerVersionUpdated", (event: any) => versions.push(...event.versions))
  await session.send("ServiceWorker.enable")
  await Bun.sleep(300)
  const mine = versions.filter((version) => String(version.scriptURL).includes(ext.id) && version.runningStatus === "running")
  for (const version of mine) await session.send("ServiceWorker.stopWorker", { versionId: version.versionId }).catch(() => undefined)
  await session.detach().catch(() => undefined)
  if (mine.length && (await gone(5_000))) return { method: "ServiceWorker.stopWorker", ms: Date.now() - started, gone: true }
  const target = await swTarget()
  if (target) await ext.cdp.send("Target.closeTarget", { targetId: target.targetId }).catch(() => undefined)
  const closed = await gone(5_000)
  return { method: mine.length ? "ServiceWorker.stopWorker+Target.closeTarget" : "Target.closeTarget", ms: Date.now() - started, gone: closed }
}
function extensionMemory() {
  const table = processTable()
  const main = [...table].find(([, info]) => info.cmd.includes(`--user-data-dir=${ext.profile}`) && !info.cmd.includes("--type="))?.[0]
  return {
    browser: main ? memoryOf(subtree(table, main)) : undefined,
    hub: ext.hub ? memoryOf(subtree(table, ext.hub.pid)) : undefined,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// One `kilo2 run` with a plan.

let runSeq = 0
async function runCli(backend: Backend, plan: Plan, options: { timeoutMs?: number; tag?: string; onSpawn?: (state: RunState) => void } = {}): Promise<RunOutcome> {
  const id = `${backend.slice(0, 3)}-${(runSeq += 1)}${options.tag ? `-${options.tag}` : ""}`
  const state: RunState = { plan, steps: [], results: [] }
  runs.set(id, state)
  const { root, env } = baseEnv(backend, ext.id)
  const dir = path.join(root, "runs", id)
  await fs.mkdir(path.join(dir, "data", "kilo2", "browser"), { recursive: true })
  await fs.symlink(browsersDir, path.join(dir, "data", "kilo2", "browser", "browsers"))
  const config = {
    model: "local/echo",
    providers: {
      local: {
        models: { echo: { limit: { context: 2_000_000, output: 4_000 }, name: "Echo" } },
        name: "Local",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { apiKey: "local-key", baseURL: `${model.url.origin}/run/${id}/v1` },
      },
    },
    browser: { backend, observation: "full", headless: false },
    permissions: [{ action: "*", effect: "allow", resource: "*" }],
  }
  const runEnv = {
    ...env,
    KILO_CONFIG_CONTENT: JSON.stringify(config),
    XDG_CACHE_HOME: path.join(dir, "cache"),
    XDG_CONFIG_HOME: path.join(dir, "config"),
    XDG_DATA_HOME: path.join(dir, "data"),
    XDG_STATE_HOME: path.join(dir, "state"),
  }
  const spawnedAt = Date.now()
  const child = Bun.spawn([binary, "run", "Measure the browser.", "--model", "local/echo", "--standalone", "--format", "json"], {
    cwd: dir,
    env: runEnv,
    stderr: "pipe",
    stdout: "pipe",
    timeout: options.timeoutMs ?? 900_000,
  })
  state.pid = child.pid
  options.onSpawn?.(state)
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const exitedAt = Date.now()
  const samples: Sample[] = []
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue
    let event: any
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const part = event?.part
    if (event?.type !== "tool_use" || part?.type !== "tool") continue
    const time = part.state?.time
    if (typeof time?.start !== "number" || typeof time?.end !== "number") continue
    const index = samples.length
    const step = state.steps[index]
    const result = state.results[index]
    const text = result?.text ?? String(part.state?.output ?? part.state?.error ?? "")
    const status = String(part.state?.status ?? "")
    const ok = status === "completed" && (step?.expect ? step.expect.test(text) : !FAILURE.test(text)) && !(step?.reject?.test(text) ?? false)
    samples.push({
      label: step?.label ?? part.tool,
      ms: time.end - time.start,
      start: time.start,
      end: time.end,
      status,
      ok,
      bytes: result?.bytes ?? 0,
      imageBytes: result?.imageBytes ?? 0,
      text: text.slice(0, 2000),
    })
  }
  runs.delete(id)
  if (code !== 0 || samples.length !== state.steps.length)
    console.error(`[${id}] exit ${code}, ${samples.length} tool events for ${state.steps.length} steps; stderr: ${stderr.slice(-400)}`)
  return { id, backend, code, spawnedAt, firstRequestAt: state.firstRequestAt, exitedAt, samples, stderr: stderr.slice(-1500), results: state.results, steps: state.steps }
}

/** A plan from a fixed sequence of step builders; each builder sees the results so far. */
const sequence =
  (builders: ((results: Result[], steps: Step[]) => Step)[]): Plan =>
  (i, results, steps) =>
    builders[i]?.(results, steps)
/** The newest snapshot-like result's ref for a role and name, or a CSS selector fallback. */
function ref(results: Result[], role: string, name: string, fallback: string): string {
  const pattern = new RegExp(`${role} "${name}"[^\\n]*?\\[ref=([^\\]]+)\\]`)
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const found = pattern.exec(results[i]!.text)?.[1]
    if (found) return found
  }
  return fallback
}
const step = (label: string, tool: string, args: unknown, extra: Partial<Step> = {}): Step => ({ label, call: { tool: `browser_${tool}`, args }, ...extra })
const repeat = <T>(count: number, make: (index: number) => T[]): T[] => Array.from({ length: count }, (_, index) => make(index)).flat()

const TOOL_CYCLE: ((results: Result[]) => Step)[] = [
  () => step("navigate", "navigate", { url: `${A}/form` }),
  () => step("snapshot", "snapshot", {}, { expect: /Click me/ }),
  (r) => step("click", "click", { element: "Click me button", target: ref(r, "button", "Click me", "#go") }),
  (r) => step("type", "type", { element: "Name field", target: ref(r, "textbox", "Name", "#name"), text: "hello" }),
  () => step("press_key", "press_key", { key: "a" }),
  (r) =>
    step("fill_form", "fill_form", {
      fields: [
        { name: "Email", type: "textbox", target: ref(r, "textbox", "Email", "#email"), value: "a@b.c" },
        { name: "Agree", type: "checkbox", target: ref(r, "checkbox", "Agree", "#agree"), value: "true" },
      ],
    }),
  () => step("screenshot", "take_screenshot", { scale: "css", type: "png" }, { keepImage: true }),
  // The page state the previous steps produced: type + press_key give "helloa", fill_form gives the email and the tick.
  () =>
    step(
      "evaluate",
      "evaluate",
      { function: "() => JSON.stringify([document.title, document.getElementById('name').value, document.getElementById('email').value, document.getElementById('agree').checked])" },
      { expect: /Form\\?",\\?"helloa\\?",\\?"a@b\.c\\?",true/ },
    ),
  () => step("tabs_list", "tabs", { action: "list" }),
  () => step("wait_for", "wait_for", { text: "Ready" }),
  () => step("find", "find", { text: "Click me" }, { expect: /Click me/ }),
]

// ---------------------------------------------------------------------------------------------------------------
// Areas.

const report: any = {
  meta: {
    measuredUnderSharedLoad: true,
    startedAt: new Date().toISOString(),
    host: os.hostname(),
    nproc,
    cli: cliVersion,
    chromium: chromiumVersion,
    chromiumPath: chromium,
    extensionDir: extensionDirectory,
    reps,
    memoryCalls,
    coldRuns,
    areas,
    command: `bun packages/kilo-cli/test/browser/perf-e2e.ts ${process.argv.slice(2).join(" ")}`,
  },
  areas: {} as Record<string, any>,
}
const orderFor = (index: number): Backend[] => (index % 2 === 0 ? ["extension", "playwright"] : ["playwright", "extension"])
async function saveImage(name: string, dataUri: string | undefined) {
  if (!dataUri) return undefined
  const file = path.join(evidenceDir, `${name}.${imageSize(dataUri)?.format ?? "bin"}`)
  await fs.writeFile(file, Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64"))
  return file
}
/** Format and pixel size from the PNG IHDR or the JPEG start-of-frame header. */
function imageSize(dataUri: string | undefined): { format: string; width: number; height: number } | undefined {
  if (!dataUri) return undefined
  const bytes = Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64")
  if (bytes.subarray(1, 4).toString("latin1") === "PNG") return { format: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  for (let at = 2; at + 9 < bytes.length; ) {
    if (bytes[at] !== 0xff) return undefined
    const marker = bytes[at + 1]!
    if (marker >= 0xc0 && marker <= 0xc3) return { format: "jpg", width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) }
    at += 2 + bytes.readUInt16BE(at + 2)
  }
  return undefined
}
const firstImage = (outcome: RunOutcome, label: string) => {
  const index = outcome.samples.findIndex((sample) => sample.label === label)
  return index >= 0 ? outcome.results[index]?.image : undefined
}
const runSummary = (outcome: RunOutcome) => ({
  id: outcome.id,
  code: outcome.code,
  calls: outcome.samples.length,
  failures: outcome.samples.filter((sample) => !sample.ok).length,
  wallMs: outcome.exitedAt - outcome.spawnedAt,
  firstCallMs: outcome.samples[0]?.ms,
  spawnToFirstRequestMs: outcome.firstRequestAt === undefined ? undefined : outcome.firstRequestAt - outcome.spawnedAt,
  spawnToFirstToolStartMs: outcome.samples[0] === undefined ? undefined : outcome.samples[0].start - outcome.spawnedAt,
  stderrTail: outcome.code === 0 ? undefined : outcome.stderr.slice(-600),
})

async function areaTools(backend: Backend) {
  const builders = [
    ...repeat(reps, () => TOOL_CYCLE),
    () => step("navigate_framed", "navigate", { url: `${A}/framed` }),
    ...repeat(reps, () => [() => step("screenshot_masked", "take_screenshot", { scale: "css", type: "png" }, { keepImage: true })]),
  ]
  const outcome = await runCli(backend, sequence(builders))
  const files = [await saveImage(`${backend}-tools-screenshot`, firstImage(outcome, "screenshot")), await saveImage(`${backend}-tools-screenshot-masked`, firstImage(outcome, "screenshot_masked"))]
  // What the model reads back from each tool, once: the payload comparison in words, not only in bytes.
  const examples = Object.fromEntries(
    outcome.samples.map((sample, index) => [sample.label, { args: JSON.stringify(outcome.steps[index]?.call.args).slice(0, 300), text: sample.text.replace(/\s+/g, " ").slice(0, 400) }]).reverse(),
  )
  return { run: runSummary(outcome), stats: byLabel(outcome.samples), examples, evidence: files.filter(Boolean) }
}

async function areaCold(backend: Backend, index: number) {
  const outcome = await runCli(backend, sequence([() => step("navigate", "navigate", { url: `${A}/?run=cold${index}` }), () => step("snapshot", "snapshot", {})]))
  return runSummary(outcome)
}

async function areaLarge(backend: Backend) {
  const builders = [
    () => step("navigate_big", "navigate", { url: `${A}/big` }),
    ...repeat(reps, () => [() => step("snapshot_10k", "snapshot", {}, { expect: /Row 0\b/ })]),
    ...repeat(reps, () => [() => step("find_10k", "find", { text: "Needle 777" }, { expect: /Needle 777/ })]),
    () => step("navigate_iframes", "navigate", { url: `${A}/iframes` }),
    ...repeat(reps, () => [() => step("snapshot_iframes", "snapshot", {})]),
    ...repeat(reps, () => [() => step("screenshot_iframes", "take_screenshot", { scale: "css", type: "png" }, { keepImage: true })]),
    () => step("navigate_long", "navigate", { url: `${A}/long` }),
    ...repeat(reps, () => [() => step("screenshot_fullpage", "take_screenshot", { scale: "css", type: "png", fullPage: true }, { keepImage: true })]),
  ]
  const outcome = await runCli(backend, sequence(builders))
  const iframes = outcome.results[outcome.samples.findIndex((sample) => sample.label === "snapshot_iframes")]?.text ?? ""
  const big = outcome.results[outcome.samples.findIndex((sample) => sample.label === "snapshot_10k")]?.text ?? ""
  return {
    run: runSummary(outcome),
    stats: byLabel(outcome.samples),
    framesInSnapshot: (iframes.match(/Frame button \d+/g) ?? []).length,
    bigSnapshot: { chars: big.length, rowsVisible: (big.match(/Row \d+/g) ?? []).length, needleVisible: big.includes("Needle 777"), tail: big.slice(-300) },
    fullPageSize: imageSize(firstImage(outcome, "screenshot_fullpage")),
    iframeScreenshotSize: imageSize(firstImage(outcome, "screenshot_iframes")),
    evidence: [
      await saveImage(`${backend}-large-fullpage`, firstImage(outcome, "screenshot_fullpage")),
      await saveImage(`${backend}-large-iframes`, firstImage(outcome, "screenshot_iframes")),
    ].filter(Boolean),
  }
}

/** The index the newest tabs list gives the tab titled "Perf Tab <k>", in either backend's list format. */
function tabIndex(results: Result[], k: number): number | undefined {
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const text = results[i]!.text
    const json = new RegExp(`"index":(\\d+)[^}]*"title":"Perf Tab ${k}"`).exec(text)?.[1]
    const markdown = new RegExp(`- (\\d+): \\[Perf Tab ${k}\\]`).exec(text)?.[1]
    if (json ?? markdown) return Number(json ?? markdown)
  }
  return undefined
}
async function areaTabs(backend: Backend) {
  const builders: ((results: Result[], steps: Step[]) => Step)[] = [
    () => step("navigate", "navigate", { url: `${A}/?tab=0` }),
    ...Array.from({ length: 19 }, (_, k) => () => step("tabs_new", "tabs", { action: "new", url: `${A}/?tab=${k + 1}` })),
    ...repeat(reps, (r) => {
      const k = (r * 7 + 3) % 20
      return [
        () => step("tabs_list", "tabs", { action: "list" }, { expect: /Perf Tab 19/ }),
        (results: Result[]) => step("tabs_select", "tabs", { action: "select", index: tabIndex(results, k) ?? k }),
        () => step(`snapshot_after_switch`, "snapshot", {}, { expect: new RegExp(`Tab ${k}\\b`) }),
      ]
    }),
  ]
  const outcome = await runCli(backend, sequence(builders))
  const list = outcome.results[outcome.samples.findIndex((sample) => sample.label === "tabs_list")]?.text ?? ""
  return {
    run: runSummary(outcome),
    stats: byLabel(outcome.samples),
    tabsInList: (list.match(/Perf Tab \d+/g) ?? []).length,
    withheldInList: (list.match(/origin withheld/g) ?? []).length,
    listChars: list.length,
    listExcerpt: list.slice(0, 700),
  }
}

/**
 * Whether a snapshot's refs still resolve after other actions: fill_form on the Email and Agree refs of one snapshot,
 * right after it and after each single action, plus two controls that tell a ref failure from a fill_form failure
 * (the same refs through type and click, and fill_form with CSS selectors). A failed fill is a failed step.
 */
const fillByRef = (r: Result[]) =>
  step("fill_form", "fill_form", {
    fields: [
      { name: "Email", type: "textbox", target: ref(r, "textbox", "Email", "#email"), value: "a@b.c" },
      { name: "Agree", type: "checkbox", target: ref(r, "checkbox", "Agree", "#agree"), value: "true" },
    ],
  })
const REF_VARIANTS: { name: string; pre: ((results: Result[]) => Step)[]; act?: ((results: Result[]) => Step)[] }[] = [
  { name: "fresh", pre: [] },
  { name: "after_click", pre: [(r) => step("pre_click", "click", { element: "Click me button", target: ref(r, "button", "Click me", "#go") })] },
  { name: "after_type", pre: [(r) => step("pre_type", "type", { element: "Name field", target: ref(r, "textbox", "Name", "#name"), text: "hello" })] },
  { name: "after_press_key", pre: [() => step("pre_press_key", "press_key", { key: "a" })] },
  { name: "after_evaluate", pre: [() => step("pre_evaluate", "evaluate", { function: "() => 1" })] },
  { name: "after_screenshot", pre: [() => step("pre_screenshot", "take_screenshot", { scale: "css", type: "png" })] },
  {
    name: "control_type_click_same_refs",
    pre: [],
    act: [
      (r) => step("fill_form", "type", { element: "Email field", target: ref(r, "textbox", "Email", "#email"), text: "a@b.c" }),
      (r) => step("click_agree", "click", { element: "Agree checkbox", target: ref(r, "checkbox", "Agree", "#agree") }),
    ],
  },
  {
    name: "control_fill_form_selectors",
    pre: [],
    act: [
      () =>
        step("fill_form", "fill_form", {
          fields: [
            { name: "Email", type: "textbox", target: "#email", value: "a@b.c" },
            { name: "Agree", type: "checkbox", target: "#agree", value: "true" },
          ],
        }),
    ],
  },
]
async function areaRefs(backend: Backend) {
  const named = (prefix: string, make: (results: Result[]) => Step) => (r: Result[]) => {
    const made = make(r)
    return { ...made, label: `${prefix}:${made.label}` }
  }
  const builders = REF_VARIANTS.flatMap((variant) => [
    () => step(`${variant.name}:navigate`, "navigate", { url: `${A}/form` }),
    () => step(`${variant.name}:snapshot`, "snapshot", {}, { expect: /Email/ }),
    ...variant.pre.map((make) => named(variant.name, make)),
    ...(variant.act ?? [fillByRef]).map((make) => named(variant.name, make)),
    () =>
      step(`${variant.name}:state`, "evaluate", { function: "() => JSON.stringify([document.getElementById('email').value, document.getElementById('agree').checked])" }, { expect: /a@b\.c\\?",true/ }),
  ])
  const outcome = await runCli(backend, sequence(builders))
  return Object.fromEntries(
    REF_VARIANTS.map((variant) => {
      const mine = outcome.samples.filter((sample) => sample.label.startsWith(`${variant.name}:`))
      const fill = mine.find((sample) => sample.label.endsWith(":fill_form"))
      const state = mine.find((sample) => sample.label.endsWith(":state"))
      return [variant.name, { fillOk: fill?.ok, stateOk: state?.ok, fill: fill?.text.replace(/\s+/g, " ").slice(0, 200), state: state?.text.slice(0, 80) }]
    }),
  )
}

function concurrentPlan(k: number): Plan {
  const own = new RegExp(`Run ${k}\\b`)
  const other = new RegExp(`Run (?!${k}\\b)\\d+\\b`)
  return sequence([
    () => step("navigate", "navigate", { url: `${A}/?run=${k}` }),
    ...repeat(reps, () => [
      () => step("snapshot", "snapshot", {}, { expect: own, reject: other }),
      (r: Result[]) => step("click", "click", { element: "Click me button", target: ref(r, "button", "Click me", "#go") }),
      () => step("evaluate", "evaluate", { function: "() => document.title" }, { expect: own, reject: other }),
      () => step("screenshot", "take_screenshot", { scale: "css", type: "png" }),
    ]),
  ])
}
async function areaConcurrent(backend: Backend) {
  const baseline = await runCli(backend, concurrentPlan(0), { tag: "alone" })
  const started = Date.now()
  const together = await Promise.all([0, 1, 2].map((k) => runCli(backend, concurrentPlan(k), { tag: `c${k}` })))
  const wallMs = Date.now() - started
  const all = together.flatMap((outcome) => outcome.samples)
  const crossTalk = all.filter((sample) => /Run \d/.test(sample.text) && !sample.ok && sample.status === "completed" && !FAILURE.test(sample.text))
  const baseStats = byLabel(baseline.samples)
  const concStats = byLabel(all)
  return {
    baseline: { run: runSummary(baseline), stats: baseStats },
    concurrent: { wallMs, runs: together.map(runSummary), stats: concStats },
    inflation: Object.fromEntries(Object.keys(concStats).map((label) => [label, Math.round(((concStats[label]!.median || 0) / (baseStats[label]?.median || 1)) * 100) / 100])),
    tabBusy: all.filter((sample) => /tab_busy/.test(sample.text)).length,
    crossTalk: crossTalk.length,
    crossTalkSamples: crossTalk.slice(0, 3).map((sample) => sample.text.slice(0, 300)),
  }
}

async function areaMemory(backend: Backend) {
  const cycle: ((results: Result[]) => Step)[] = [
    () => step("navigate", "navigate", { url: `${A}/form` }),
    () => step("snapshot", "snapshot", {}, { expect: /Click me/ }),
    (r) => step("click", "click", { element: "Click me button", target: ref(r, "button", "Click me", "#go") }),
    (r) => step("type", "type", { element: "Name field", target: ref(r, "textbox", "Name", "#name"), text: "hello" }),
    () => step("screenshot", "take_screenshot", { scale: "css", type: "png" }),
    () => step("evaluate", "evaluate", { function: "() => document.title" }, { expect: /Form/ }),
    () => step("find", "find", { text: "Click me" }, { expect: /Click me/ }),
    () => step("tabs_list", "tabs", { action: "list" }),
    () => step("wait_for", "wait_for", { text: "Ready" }),
    () => step("press_key", "press_key", { key: "a" }),
  ]
  const series: any[] = []
  let pid = 0
  const sample = async (calls: number) => {
    const table = processTable()
    const chrome = isChrome(table)
    const entry: any = { calls, at: Date.now(), load: loadavg() }
    if (backend === "extension") {
      const memory = extensionMemory()
      entry.swHeapMb = await swHeapMb()
      entry.browser = memory.browser
      entry.hub = memory.hub
      entry.cli = pid ? memoryOf(subtree(table, pid)) : undefined
      const { targetInfos } = await ext.cdp.send("Target.getTargets")
      entry.pageTargets = targetInfos.filter((info: any) => info.type === "page").length
    } else {
      entry.cli = pid ? memoryOf(subtree(table, pid, chrome)) : undefined
      const roots = pid ? subtree(table, pid).filter((p) => chrome(p) && !chrome(table.get(p)!.ppid)) : []
      entry.browser = memoryOf(roots.flatMap((root) => subtree(table, root)))
    }
    series.push(entry)
  }
  const plan: Plan = (i, results) => {
    if (i >= memoryCalls) return undefined
    const made = cycle[i % cycle.length]!(results)
    return i % 100 === 0 ? { ...made, before: () => sample(i) } : made
  }
  const outcome = await runCli(backend, plan, { timeoutMs: 3_600_000, onSpawn: (state) => (pid = state.pid ?? 0) })
  pid = 0
  await sample(outcome.samples.length)
  const windows = Array.from({ length: Math.ceil(outcome.samples.length / 100) }, (_, w) => {
    const slice = outcome.samples.slice(w * 100, w * 100 + 100)
    return { from: w * 100, median: median(slice.map((s) => s.ms)), p95: percentile(slice.map((s) => s.ms), 95), failures: slice.filter((s) => !s.ok).length }
  })
  return { run: runSummary(outcome), series, windows, stats: byLabel(outcome.samples) }
}

async function areaReconnect() {
  // The side panel would wake the worker on its own; production users mostly have it closed.
  const helper = await ext.context.newPage()
  await helper.goto("about:blank")
  if (ext.panel) {
    await ext.panel.close().catch(() => undefined)
    ext.panel = undefined
  }
  const scenarios: any[] = []
  for (const scenario of ["immediate", "idle35s"] as const) {
    const info: any = { scenario }
    let stoppedAt = 0
    let swBackAt: number | undefined
    let watching = true
    const logFrom = ext.hubLog.length
    const watch = (async () => {
      while (watching) {
        if (stoppedAt && swBackAt === undefined && (await swTarget())) swBackAt = Date.now()
        await Bun.sleep(100)
      }
    })()
    let recovered = false
    const plan: Plan = (i, results, steps) => {
      if (i === 0) return step("navigate", "navigate", { url: `${A}/form` })
      if (i === 1) return step("snapshot_before", "snapshot", {}, { expect: /Click me/ })
      if (i === 2)
        return step("snapshot_stopped", "snapshot", {}, {
          expect: /Click me/,
          before: async () => {
            info.stop = await stopWorker(helper)
            stoppedAt = Date.now()
            if (scenario === "idle35s") await Bun.sleep(35_000)
          },
        })
      const last = results[i - 1]?.text ?? ""
      if (!recovered && /Click me/.test(last) && steps[i - 1]?.label !== "snapshot_before") recovered = true
      if (!recovered) {
        if (Date.now() - stoppedAt > 60_000) return undefined
        return step("snapshot_retry", "snapshot", {}, { expect: /Click me/, before: () => Bun.sleep(1_000) })
      }
      const after = steps.filter((s) => s.label.startsWith("after_")).length
      if (after >= 10) return undefined
      return after % 2 === 0
        ? step("after_snapshot", "snapshot", {}, { expect: /Click me/ })
        : step("after_click", "click", { element: "Click me button", target: ref(results, "button", "Click me", "#go") })
    }
    const outcome = await runCli("extension", plan)
    watching = false
    await watch
    const stopped = outcome.samples.find((sample) => sample.label === "snapshot_stopped")
    const firstOk = outcome.samples.find((sample, index) => index >= 2 && sample.ok)
    info.run = runSummary(outcome)
    info.whileStopped = stopped && { ms: stopped.ms, ok: stopped.ok, status: stopped.status, text: stopped.text.slice(0, 600) }
    info.failedAttempts = outcome.samples.filter((sample, index) => index >= 2 && !sample.ok).length
    info.failureTexts = [...new Set(outcome.samples.filter((s, index) => index >= 2 && !s.ok).map((s) => s.text.replace(/\s+/g, " ").slice(0, 300)))].slice(0, 4)
    info.stopToFirstSuccessMs = firstOk ? firstOk.end - stoppedAt : undefined
    info.firstSuccessCallMs = firstOk?.ms
    info.swBackAfterMs = swBackAt === undefined ? undefined : swBackAt - stoppedAt
    info.after = byLabel(outcome.samples.filter((sample) => sample.label.startsWith("after_")))
    info.hubLog = ext.hubLog.slice(logFrom).split("\n").filter(Boolean).slice(-15)
    // A new conversation after the restart: does the extension serve a fresh session?
    const fresh = await runCli("extension", sequence([() => step("navigate", "navigate", { url: `${A}/form` }), () => step("snapshot", "snapshot", {}, { expect: /Click me/ })]))
    info.freshRun = { ...runSummary(fresh), texts: fresh.samples.map((sample) => `${sample.ok ? "ok" : "FAIL"} ${sample.ms} ms: ${sample.text.replace(/\s+/g, " ").slice(0, 160)}`) }
    scenarios.push(info)
  }
  return { panelOpen: false, scenarios }
}

/**
 * Where the extension spends a 10k-element snapshot and find: CPU profiles of its service worker and of the agent's
 * page while one run snapshots and searches the big page. The profiles go to the evidence directory.
 */
async function areaProfile() {
  let sw: { send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>; detach(): Promise<void> } | undefined
  let page: any
  const start = async () => {
    sw = await swAttach()
    await sw?.send("Profiler.enable")
    await sw?.send("Profiler.setSamplingInterval", { interval: 200 })
    await sw?.send("Profiler.start")
    const tab = [...ext.context.pages()].reverse().find((candidate: any) => candidate.url().endsWith("/big"))
    if (tab) {
      page = await ext.context.newCDPSession(tab)
      await page.send("Profiler.enable")
      await page.send("Profiler.setSamplingInterval", { interval: 200 })
      await page.send("Profiler.start")
    }
  }
  const outcome = await runCli(
    "extension",
    sequence([
      () => step("navigate_big", "navigate", { url: `${A}/big` }),
      () => step("snapshot_10k", "snapshot", {}, { before: start }),
      ...repeat(4, () => [() => step("snapshot_10k", "snapshot", {})]),
      ...repeat(5, () => [() => step("find_10k", "find", { text: "Needle 777" })]),
    ]),
  )
  const swProfile = (await sw?.send("Profiler.stop", {}, 30_000))?.profile
  await sw?.detach()
  const pageProfile = page ? (await page.send("Profiler.stop")).profile : undefined
  // The raw CDP cost the extension's snapshot starts from: one full accessibility tree of the same page.
  const axTree: { ms: number; nodes: number }[] = []
  for (let i = 0; i < 3 && page; i += 1) {
    const started = performance.now()
    const tree = await page.send("Accessibility.getFullAXTree")
    axTree.push({ ms: Math.round(performance.now() - started), nodes: tree.nodes.length })
  }
  const files: string[] = []
  for (const [name, profile] of [["sw", swProfile], ["page", pageProfile]] as const) {
    if (!profile) continue
    const file = path.join(evidenceDir, `extension-profile-${name}-10k.cpuprofile`)
    await fs.writeFile(file, JSON.stringify(profile))
    files.push(file)
  }
  return {
    run: runSummary(outcome),
    stats: byLabel(outcome.samples),
    callsWallMs: outcome.samples.slice(1).reduce((sum, sample) => sum + sample.ms, 0),
    sw: swProfile ? topSelf(swProfile) : undefined,
    page: pageProfile ? topSelf(pageProfile) : undefined,
    axTree,
    evidence: files,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Run every area, alternating the backend order.

await launchExtension()
report.meta.pairingMs = ext.pairingMs
report.meta.extensionId = ext.id
report.meta.swHeapIdleMb = await swHeapMb()

for (const [index, area] of areas.entries()) {
  const order = orderFor(index)
  const entry: any = { order, loadStart: loadavg(), startedAt: new Date().toISOString() }
  console.error(`[area ${area}] start; load ${entry.loadStart}`)
  try {
    if (area === "tools") for (const backend of order) entry[backend] = await areaTools(backend)
    if (area === "cold") {
      for (const backend of order) entry[backend] = { runs: [] as any[] }
      for (let i = 0; i < coldRuns; i += 1) for (const backend of i % 2 === 0 ? order : [...order].reverse()) entry[backend].runs.push(await areaCold(backend, i))
      for (const backend of order) {
        const list = entry[backend].runs as { firstCallMs?: number; spawnToFirstRequestMs?: number; spawnToFirstToolStartMs?: number }[]
        entry[backend].firstCallMedianMs = median(list.map((run) => run.firstCallMs ?? 0))
        entry[backend].spawnToFirstRequestMedianMs = median(list.map((run) => run.spawnToFirstRequestMs ?? 0))
        entry[backend].spawnToFirstToolStartMedianMs = median(list.map((run) => run.spawnToFirstToolStartMs ?? 0))
      }
      entry.cliStartupDeltaMs = entry.extension.spawnToFirstRequestMedianMs - entry.playwright.spawnToFirstRequestMedianMs
      entry.pairingMs = ext.pairingMs
    }
    if (area === "large") for (const backend of order) entry[backend] = await areaLarge(backend)
    if (area === "tabs") for (const backend of order) entry[backend] = await areaTabs(backend)
    if (area === "concurrent") for (const backend of order) entry[backend] = await areaConcurrent(backend)
    if (area === "memory") for (const backend of order) entry[backend] = await areaMemory(backend)
    if (area === "reconnect") entry.extension = await areaReconnect()
    if (area === "profile") entry.extension = await areaProfile()
    if (area === "refs") for (const backend of order) entry[backend] = await areaRefs(backend)
  } catch (error) {
    entry.error = String((error as Error)?.stack ?? error)
    console.error(`[area ${area}] failed: ${entry.error}`)
  }
  entry.loadEnd = loadavg()
  entry.finishedAt = new Date().toISOString()
  report.areas[area] = entry
  await fs.writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2))
}
report.meta.finishedAt = new Date().toISOString()
report.meta.hubLogTail = ext.hubLog.split("\n").filter(Boolean).slice(-20)

// ---------------------------------------------------------------------------------------------------------------
// Markdown.

const fmt = (value: number | undefined) => (value === undefined || !Number.isFinite(value) ? "–" : String(Math.round(value)))
const ratio = (a?: number, b?: number) => (a === undefined || b === undefined || !b ? "–" : `${(a / b).toFixed(2)}×`)
function compare(title: string, ext?: Record<string, Stat>, pw?: Record<string, Stat>): string[] {
  const labels = [...new Set([...Object.keys(ext ?? {}), ...Object.keys(pw ?? {})])]
  const lines = [
    `| ${title} | ext n | ext median ms | ext p95 ms | pw median ms | pw p95 ms | ext/pw | ext bytes | pw bytes | ext fail | pw fail |`,
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ]
  for (const label of labels) {
    const e = ext?.[label]
    const p = pw?.[label]
    lines.push(
      `| ${label} | ${e?.n ?? "–"} | ${fmt(e?.median)} | ${fmt(e?.p95)} | ${fmt(p?.median)} | ${fmt(p?.p95)} | ${ratio(e?.median, p?.median)} | ${fmt(e?.bytesMedian)} | ${fmt(p?.bytesMedian)} | ${e?.failures ?? "–"} | ${p?.failures ?? "–"} |`,
    )
  }
  const failures = labels.flatMap((label) =>
    (["extension", "playwright"] as const).flatMap((backend) => ((backend === "extension" ? ext : pw)?.[label]?.failureSamples ?? []).map((text) => `- ${backend} ${label}: \`${text.replaceAll("`", "'")}\``)),
  )
  return failures.length ? [...lines, "", "Failure texts:", ...failures] : lines
}
const loadLine = (entry: any) => `Load (1/5/15 min, running/total, last pid) start \`${entry.loadStart}\`, end \`${entry.loadEnd}\`; nproc ${nproc}. Order: ${entry.order?.join(" → ")}.${entry.error ? ` **Area error:** \`${String(entry.error).split("\n")[0]}\`` : ""}`

const md: string[] = [
  `# Browser bridge performance: extension vs bundled Playwright`,
  "",
  `**Measured under shared load** (other agents' Chromium/xvfb and services on the same VM); not final numbers.`,
  "",
  `- Host ${report.meta.host}, nproc ${nproc}; CLI \`${cliVersion}\`; ${chromiumVersion} (both backends); extension \`${extensionDirectory}\``,
  `- ${reps} repetitions per tool; latency = CLI \`tool_use\` event time.end − time.start (execute boundary); bytes = model-visible JSON of the step's result messages`,
  `- Started ${report.meta.startedAt}, finished ${report.meta.finishedAt}`,
  `- Rerun: \`${report.meta.command}\``,
  "",
]
const areaEntry = (name: string) => report.areas[name]
if (areaEntry("tools")) {
  const entry = areaEntry("tools")
  md.push("## 1. Per-tool latency", "", loadLine(entry), "", ...compare("tool", entry.extension?.stats, entry.playwright?.stats), "")
  md.push(`Runs: ext ${JSON.stringify(entry.extension?.run)}; pw ${JSON.stringify(entry.playwright?.run)}`, "")
  const cell = (text: unknown) => `\`${String(text ?? "–").slice(0, 160).replaceAll("`", "'").replaceAll("|", "/")}\``
  md.push("| tool | extension result text (first 160 chars) | playwright result text |", "|---|---|---|")
  for (const label of Object.keys(entry.extension?.examples ?? {}))
    md.push(`| ${label} | ${cell(entry.extension.examples[label]?.text)} | ${cell(entry.playwright?.examples?.[label]?.text)} |`)
  md.push("")
}
if (areaEntry("cold")) {
  const entry = areaEntry("cold")
  md.push("## 2. Cold start, pairing, CLI startup", "", loadLine(entry), "")
  md.push("| metric | extension | playwright |", "|---|---|---|")
  md.push(`| first browser call of a run, median ms (${coldRuns} fresh runs) | ${fmt(entry.extension?.firstCallMedianMs)} | ${fmt(entry.playwright?.firstCallMedianMs)} |`)
  md.push(`| spawn → first model request, median ms | ${fmt(entry.extension?.spawnToFirstRequestMedianMs)} | ${fmt(entry.playwright?.spawnToFirstRequestMedianMs)} |`)
  md.push(`| spawn → first tool start, median ms | ${fmt(entry.extension?.spawnToFirstToolStartMedianMs)} | ${fmt(entry.playwright?.spawnToFirstToolStartMedianMs)} |`)
  md.push(`| pairing (hub spawn → paired), ms | ${fmt(entry.pairingMs)} | n/a |`)
  md.push(`| CLI startup delta (ext − pw, spawn → first model request) | ${fmt(entry.cliStartupDeltaMs)} | |`, "")
  md.push(`First-call ms per run: ext ${JSON.stringify(entry.extension?.runs?.map((r: any) => r.firstCallMs))}, pw ${JSON.stringify(entry.playwright?.runs?.map((r: any) => r.firstCallMs))}`, "")
}
if (areaEntry("reconnect")) {
  const entry = areaEntry("reconnect")
  md.push("## 3. Reconnect after a service-worker stop (extension only)", "", loadLine(entry), "", "Side panel closed (production default).", "")
  md.push("| scenario | stop method | call while stopped | failed attempts | stop → first success ms | SW back after ms | after-reconnect snapshot median ms |", "|---|---|---|---|---|---|---|")
  for (const s of entry.extension?.scenarios ?? [])
    md.push(
      `| ${s.scenario} | ${s.stop?.method} (${s.stop?.gone ? "gone" : "STILL RUNNING"} in ${s.stop?.ms} ms) | ${s.whileStopped ? `${s.whileStopped.ok ? "ok" : "failed"} after ${s.whileStopped.ms} ms` : "–"} | ${s.failedAttempts} | ${fmt(s.stopToFirstSuccessMs)} | ${fmt(s.swBackAfterMs)} | ${fmt(s.after?.after_snapshot?.median)} |`,
    )
  md.push("")
  for (const s of entry.extension?.scenarios ?? []) {
    md.push(`Model-visible text, ${s.scenario}, call while stopped: \`${String(s.whileStopped?.text ?? "").replace(/\s+/g, " ").slice(0, 400).replaceAll("`", "'")}\``)
    for (const text of s.failureTexts ?? []) md.push(`- failure text: \`${text.replaceAll("`", "'")}\``)
    md.push(`- a new \`kilo2 run\` afterwards: ${(s.freshRun?.texts ?? []).map((text: string) => `\`${text.replaceAll("`", "'")}\``).join("; ")}`)
  }
  md.push("")
}
if (areaEntry("memory")) {
  const entry = areaEntry("memory")
  md.push(`## 4. Memory over ${memoryCalls} mixed calls`, "", loadLine(entry), "")
  md.push("| calls | ext SW heap MB (after GC) | ext CLI RSS MB | ext hub RSS MB | ext browser RSS/PSS MB | ext pages | pw CLI RSS MB | pw browser RSS/PSS MB |", "|---|---|---|---|---|---|---|---|")
  const es = entry.extension?.series ?? []
  const ps = entry.playwright?.series ?? []
  for (let i = 0; i < Math.max(es.length, ps.length); i += 1) {
    const e = es[i]
    const p = ps[i]
    md.push(
      `| ${e?.calls ?? p?.calls} | ${e?.swHeapMb ?? "–"} | ${e?.cli?.rssMb ?? "–"} | ${e?.hub?.rssMb ?? "–"} | ${e?.browser ? `${e.browser.rssMb}/${e.browser.pssMb}` : "–"} | ${e?.pageTargets ?? "–"} | ${p?.cli?.rssMb ?? "–"} | ${p?.browser ? `${p.browser.rssMb}/${p.browser.pssMb}` : "–"} |`,
    )
  }
  md.push("", "Latency per 100-call window (median/p95 ms, failures):", "")
  md.push("| window | ext | pw |", "|---|---|---|")
  const ew = entry.extension?.windows ?? []
  const pwWindows = entry.playwright?.windows ?? []
  for (let i = 0; i < Math.max(ew.length, pwWindows.length); i += 1)
    md.push(`| ${ew[i]?.from ?? pwWindows[i]?.from} | ${ew[i] ? `${ew[i].median}/${ew[i].p95} (${ew[i].failures})` : "–"} | ${pwWindows[i] ? `${pwWindows[i].median}/${pwWindows[i].p95} (${pwWindows[i].failures})` : "–"} |`)
  md.push("", `Runs: ext ${JSON.stringify(entry.extension?.run)}; pw ${JSON.stringify(entry.playwright?.run)}`, "")
}
if (areaEntry("large")) {
  const entry = areaEntry("large")
  md.push("## 5. Large pages", "", loadLine(entry), "", ...compare("step", entry.extension?.stats, entry.playwright?.stats), "")
  md.push(`Frame buttons visible in the 20-iframe snapshot: ext ${entry.extension?.framesInSnapshot}, pw ${entry.playwright?.framesInSnapshot}. Full-page image: ext ${JSON.stringify(entry.extension?.fullPageSize)}, pw ${JSON.stringify(entry.playwright?.fullPageSize)}.`, "")
  md.push(`10k snapshot text: ext ${JSON.stringify({ ...entry.extension?.bigSnapshot, tail: undefined })}, pw ${JSON.stringify({ ...entry.playwright?.bigSnapshot, tail: undefined })}.`, "")
  md.push(`10k snapshot tail: ext \`${String(entry.extension?.bigSnapshot?.tail ?? "").replace(/\s+/g, " ").slice(-200).replaceAll("`", "'")}\`; pw \`${String(entry.playwright?.bigSnapshot?.tail ?? "").replace(/\s+/g, " ").slice(-200).replaceAll("`", "'")}\``, "")
}
if (areaEntry("profile")) {
  const entry = areaEntry("profile")
  const p = entry.extension
  md.push("## 5b. Extension CPU profile: 5 snapshots + 5 finds on the 10k page", "", loadLine(entry), "")
  md.push(`Calls: ${JSON.stringify(Object.fromEntries(Object.entries(p?.stats ?? {}).map(([label, s]: [string, any]) => [label, `${s.median}/${s.p95} ms`])))}; sum of call times after navigate ${p?.callsWallMs} ms. SW profile busy ${p?.sw?.busyMs}/${p?.sw?.totalMs} ms; page profile busy ${p?.page?.busyMs}/${p?.page?.totalMs} ms.`, "")
  md.push(`Raw \`Accessibility.getFullAXTree\` on the same page from the harness's own CDP session: ${JSON.stringify(p?.axTree)}.`, "")
  for (const [name, summary] of [["service worker", p?.sw], ["page", p?.page]] as const) {
    if (!summary) continue
    md.push(`| ${name} top self time | ms |`, "|---|---|", ...summary.top.map((row: any) => `| \`${row.fn}\` | ${row.selfMs} |`), "")
  }
}
if (areaEntry("refs")) {
  const entry = areaEntry("refs")
  md.push("## 1b. Ref stability: fill_form with refs from one snapshot, after one other action", "", loadLine(entry), "")
  md.push("| variant | ext fill_form | ext page state | pw fill_form | pw page state | ext text |", "|---|---|---|---|---|---|")
  for (const variant of REF_VARIANTS.map((v) => v.name)) {
    const e = entry.extension?.[variant]
    const p = entry.playwright?.[variant]
    md.push(`| ${variant} | ${e?.fillOk ? "ok" : "FAIL"} | ${e?.stateOk ? "ok" : "FAIL"} | ${p?.fillOk ? "ok" : "FAIL"} | ${p?.stateOk ? "ok" : "FAIL"} | \`${String(e?.fill ?? "").slice(0, 120).replaceAll("`", "'")}\` |`)
  }
  md.push("")
}
if (areaEntry("tabs")) {
  const entry = areaEntry("tabs")
  md.push("## 6. Many tabs (20 in the session)", "", loadLine(entry), "", ...compare("step", entry.extension?.stats, entry.playwright?.stats), "")
  md.push(`Tabs named in the list: ext ${entry.extension?.tabsInList} (+${entry.extension?.withheldInList} withheld-origin entries, ${entry.extension?.listChars} chars), pw ${entry.playwright?.tabsInList} (${entry.playwright?.listChars} chars). \`snapshot_after_switch\` failures = the snapshot did not show the selected tab.`, "")
}
if (areaEntry("concurrent")) {
  const entry = areaEntry("concurrent")
  md.push("## 7. Three concurrent `kilo2 run` sessions", "", loadLine(entry), "")
  for (const backend of ["extension", "playwright"] as const) {
    const b = entry[backend]
    if (!b) continue
    md.push(`### ${backend}`, "", `Wall: 3 runs together ${b.concurrent?.wallMs} ms vs one alone ${b.baseline?.run?.wallMs} ms. tab_busy results: ${b.tabBusy}. Cross-talk (another run's page): ${b.crossTalk}.`, "")
    md.push("| tool | alone median/p95 | 3 concurrent median/p95 | inflation | concurrent failures |", "|---|---|---|---|---|")
    for (const label of Object.keys(b.concurrent?.stats ?? {}))
      md.push(`| ${label} | ${fmt(b.baseline?.stats?.[label]?.median)}/${fmt(b.baseline?.stats?.[label]?.p95)} | ${fmt(b.concurrent.stats[label].median)}/${fmt(b.concurrent.stats[label].p95)} | ${b.inflation?.[label]}× | ${b.concurrent.stats[label].failures} |`)
    for (const text of Object.values(b.concurrent?.stats ?? {}).flatMap((s: any) => s.failureSamples)) md.push(`- failure text: \`${String(text).replaceAll("`", "'")}\``)
    md.push("")
  }
}
const markdown = md.join("\n")
await fs.writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2))
await fs.writeFile(path.join(outDir, "report.md"), markdown)
console.log(markdown)
console.error(`report: ${outDir}/report.json, ${outDir}/report.md; evidence: ${evidenceDir}`)
try {
  ext.hub?.kill("SIGTERM")
} catch {}
for (const server of servers) server.stop(true)
model.stop(true)
// The browser teardown can wait on open targets; the report is written.
process.exit(0)
