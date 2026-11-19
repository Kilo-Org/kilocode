#!/usr/bin/env bun
// Temporary performance harness for the browser bridge: both backends, the same fixture pages, a scripted model.
// It runs one `kilo2 run` per backend with 20 repetitions of navigate/snapshot/click/screenshot, then reports the
// per-tool latencies from the run's tool events, cold start, pairing, payload sizes and the extension SW heap.
import * as Png from "@kilocode/kilo-plugin/browser/png"
import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"

const binaryInput = process.argv[2]
const backend = (process.argv[3] ?? "extension") as "extension" | "playwright"
const reps = Number(process.argv[4] ?? "20")
const mode = process.argv[5] ?? "full"
if (!binaryInput) throw new Error("usage: bun perf-e2e.ts <kilo2> extension|playwright [reps]")
const binary = path.resolve(binaryInput)

const pluginDirectory = path.resolve(import.meta.dirname, "../../../kilo-plugin")
const playwright: any = await import(Bun.resolveSync("playwright-core", pluginDirectory))
const extensionDirectory = process.env.E2E_EXTENSION_DIR ?? ""

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Perf</title></head>
<body>
  <h1>Perf</h1>
  <button id="go">Click me</button>
  <p id="status">idle</p>
  <script>document.getElementById("go").addEventListener("click", () => {
    document.getElementById("status").textContent = "clicked"
    document.body.style.background = "#00ff00"
  })</script>
</body></html>`

const framedChild = Bun.serve({
  hostname: "127.0.0.2",
  port: 0,
  fetch: () => new Response("<h1>FRAME</h1>", { headers: { "content-type": "text/html; charset=utf-8" } }),
})
const FRAMED = `<!doctype html>
<html><head><meta charset="utf-8"><title>Perf framed</title></head>
<body style="margin:0">
  <iframe src="${framedChild.url.origin}/" style="position:fixed;left:0;top:0;width:320px;height:200px;border:0"></iframe>
  <h1 style="position:fixed;left:400px;top:0">Perf</h1>
</body></html>`

const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    const page = new URL(request.url).pathname === "/framed" ? FRAMED : PAGE
    return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } })
  },
})
const origin = fixture.url.origin

const chunk = (model: string, delta: object, finish: string | null) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish, index: 0 }], id: "local", model, object: "chat.completion.chunk" })}\n\n`
const toolCall = (model: string, name: string, args: unknown) =>
  [
    chunk(
      model,
      {
        role: "assistant",
        tool_calls: [
          { function: { arguments: JSON.stringify(args), name }, id: `call_${name}_${Date.now()}`, index: 0, type: "function" },
        ],
      },
      null,
    ),
    chunk(model, {}, "tool_calls"),
    "data: [DONE]\n\n",
  ].join("")
const answer = (model: string, text: string) => [chunk(model, { content: text, role: "assistant" }, null), chunk(model, {}, "stop"), "data: [DONE]\n\n"].join("")

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined
const textOf = (content: unknown): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.flatMap((part) => (field(part, "type") === "text" && typeof field(part, "text") === "string" ? [String(field(part, "text"))] : [])).join("\n")
}
const readStep = (messages: unknown) => {
  const results: string[] = []
  if (!Array.isArray(messages)) return results
  for (const message of messages) if (field(message, "role") === "tool") results.push(textOf(field(message, "content")))
  return results
}

const total = reps * 4
const payloads: number[][] = [[], [], [], []]
const activeIds: number[] = []
let onCycle: (() => Promise<void>) | undefined
const sse = (body: string) => new Response(body, { headers: { "content-type": "text/event-stream" } })
const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
    const body: unknown = await request.json()
    const name = typeof field(body, "model") === "string" ? String(field(body, "model")) : "local"
    const results = readStep(field(body, "messages"))
    const declared = field(body, "tools")
    const toolNames = Array.isArray(declared)
      ? declared.flatMap((tool) => (typeof field(field(tool, "function"), "name") === "string" ? [String(field(field(tool, "function"), "name"))] : []))
      : []
    const direct = toolNames.some((tool) => tool.startsWith("browser_"))
    const call = (tool: string, args: unknown) =>
      direct
        ? toolCall(name, tool, args)
        : toolCall(name, "execute", { code: `return await tools.browser.${tool.slice("browser_".length)}(${JSON.stringify(args)})` })
    const messages = field(body, "messages")
    if (Array.isArray(messages)) {
      let last: unknown
      for (const message of messages) if (field(message, "role") === "tool") last = field(message, "content")
      if (last !== undefined && results.length > 0) payloads[(results.length - 1) % 4]?.push(JSON.stringify(last).length)
    }
    const i = results.length
    if (i > 0 && i % 4 === 0) await onCycle?.()
    if (mode === "screenshot-plain" || mode === "screenshot-framed") {
      const target = mode === "screenshot-framed" ? `${origin}/framed` : origin
      if (i === 0) return sse(call("browser_navigate", { url: target }))
      if (i <= reps) return sse(call("browser_take_screenshot", { scale: "css", type: "png" }))
      return sse(answer(name, "done"))
    }
    if (i >= total) return sse(answer(name, "done"))
    const phase = i % 4
    if (phase === 0) return sse(call("browser_navigate", { url: origin }))
    if (phase === 1) return sse(call("browser_snapshot", {}))
    if (phase === 2) {
      const ref = /button "Click me" \[ref=([^\]]+)\]/.exec(results[i - 1] ?? "")?.[1]
      return sse(call("browser_click", ref ? { element: "the button", target: ref } : { element: "the button", target: "e1" }))
    }
    return sse(call("browser_take_screenshot", { scale: "css", type: "png" }))
  },
})

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

function config(root: string) {
  return {
    model: "local/echo",
    providers: {
      local: {
        models: { echo: { limit: { context: 200_000, output: 4_000 }, name: "Echo" } },
        name: "Local",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { apiKey: "local-key", baseURL: `${model.url.origin}/v1` },
      },
    },
    browser: { backend, observation: "full", headless: false },
    permissions: [{ action: "*", effect: "allow", resource: "*" }],
  }
}

let extensionId = ""
let context: any

async function enableLocalAgents() {
  await context.route("https://app.kilo.ai/api/user", (route: any) => route.fulfill({ json: { google_user_email: "perf@kilo.ai" }, status: 200 }))
  await context.route("https://app.kilo.ai/api/organizations", (route: any) => route.fulfill({ json: { organizations: [] }, status: 200 }))
  await context.route((url: URL) => url.origin === "https://app.kilo.ai" && url.pathname.startsWith("/api/trpc/"), (route: any) => route.fulfill({ json: {}, status: 200 }))
  await context.addInitScript({ content: "Object.defineProperty(chrome.permissions, 'request', { value: () => Promise.resolve(true) });" })
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await panel.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const global = globalThis as { chrome?: { runtime?: { lastError?: { message?: string } }; storage?: { local?: { set(items: Record<string, unknown>, callback: () => void): void } } } }
        const api = global.chrome
        if (!api?.storage?.local) return reject(new Error("no storage"))
        api.storage.local.set({ kiloAuth: { token: "token-1", userEmail: "perf@kilo.ai" } }, () => {
          const message = api.runtime?.lastError?.message
          if (message) reject(new Error(message))
          else resolve()
        })
      }),
  )
  await panel.reload()
  await panel.getByRole("button", { name: "Settings" }).click()
  const toggle = panel.getByRole("switch", { name: "Allow local agents" })
  await toggle.waitFor()
  await toggle.click()
  await Bun.sleep(500)
  return panel
}

async function swHeap(panel: any): Promise<{ used: number; total: number } | undefined> {
  const browser = context.browser()
  if (!browser) return undefined
  const session = await browser.newBrowserCDPSession()
  const { targetInfos } = await session.send("Target.getTargets")
  const target = targetInfos.find((info: any) => info.type === "service_worker" && String(info.url).includes(extensionId))
  if (!target) return undefined
  const { sessionId } = await session.send("Target.attachToTarget", { targetId: target.targetId, flatten: false })
  const { promise, resolve } = Promise.withResolvers<{ used: number; total: number } | undefined>()
  session.on("Target.receivedMessageFromTarget", (event: any) => {
    if (event.sessionId !== sessionId) return
    const message = JSON.parse(event.message)
    if (message.id !== 1) return
    resolve(message.result ? { used: message.result.usedSize, total: message.result.totalSize } : undefined)
  })
  await session.send("Target.sendMessageToTarget", {
    sessionId,
    message: JSON.stringify({ id: 1, method: "Runtime.getHeapUsage", params: {} }),
  })
  return await promise
}

type Sample = { tool: string; ms: number; bytes: number }

function samples(stdout: string): Sample[] {
  const out: Sample[] = []
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
    const content = JSON.stringify(part.state?.content ?? "")
    out.push({ bytes: content.length, ms: time.end - time.start, tool: part.tool })
  }
  return out
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[at] ?? 0
}
const median = (values: number[]) => percentile(values, 50)

const base = await fs.mkdtemp(path.join(os.tmpdir(), "perf-bridge-"))
const root = path.join(base, backend)
await fs.mkdir(path.join(root, "bin"), { recursive: true })
await fs.mkdir(path.join(root, "run"), { recursive: true, mode: 0o700 })
await fs.writeFile(path.join(root, "bin", "xdg-open"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })

let pairingMs: number | undefined
let idleHeap: { used: number; total: number } | undefined
let busyHeap: { used: number; total: number } | undefined
let panel: any
let hub: any
let hubLog = { text: "" }

if (backend === "extension") {
  // The accepted-permission state: automation cannot answer Chrome's optional-permission prompt.
  const source = extensionDirectory
  const loaded = path.join(base, "extension-downloads")
  await fs.rm(loaded, { recursive: true, force: true })
  await fs.cp(source, loaded, { recursive: true })
  const manifestPath = path.join(loaded, "manifest.json")
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { optional_permissions?: string[]; permissions?: string[] }
  const optional = (manifest.optional_permissions ?? []).filter((permission) => permission !== "downloads")
  const permissions = [...(manifest.permissions ?? [])]
  if (!permissions.includes("downloads")) permissions.push("downloads")
  await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, optional_permissions: optional, permissions }, null, 2))
  await fs.access(path.join(loaded, "manifest.json"))
  context = await playwright.chromium.launchPersistentContext(path.join(base, "profile"), {
    args: [
      `--disable-extensions-except=${loaded}`,
      `--load-extension=${loaded}`,
      "--disable-blink-features=AutomationControlled",
      ...(process.env.E2E_DSF === undefined ? [] : [`--force-device-scale-factor=${process.env.E2E_DSF}`]),
    ],
    executablePath: playwright.chromium.executablePath(),
    headless: false,
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: process.env.E2E_DSF === undefined ? { height: 900, width: 1280 } : null,
  })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  extensionId = new URL(worker.url()).host
  panel = await enableLocalAgents()
  await Bun.sleep(1000)
  idleHeap = await swHeap(panel)
  const sampleActive = async () => {
    const id = await panel.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => resolve(tabs[0]?.id ?? -1))
        }),
    )
    activeIds.push(Number(id))
  }
  await sampleActive()
  onCycle = sampleActive
}

const run = { text: "" }
const env = {
  ...process.env,
  HOME: root,
  KILO_API_KEY: "",
  KILO_AUTH_CONTENT: "",
  KILO_BROWSER_DATA_DIR: path.join(root, "data", "kilo2", "browser"),
  KILO_BROWSER_EXTRA_EXTENSION_IDS: extensionId,
  KILO_BROWSER_RUN_DIR: path.join(root, "run", "browser"),
  KILO_CONFIG_CONTENT: JSON.stringify(config(root)),
  KILO_DISABLE_AUTOUPDATE: "1",
  KILO_DISABLE_MODELS_FETCH: "1",
  PATH: `${path.join(root, "bin")}:${process.env.PATH ?? ""}`,
  XDG_CACHE_HOME: path.join(root, "cache"),
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_RUNTIME_DIR: path.join(root, "run"),
  XDG_STATE_HOME: path.join(root, "state"),
}

async function readEntry() {
  const directory = path.join(root, "run", "browser", "hubs")
  const files = await fs.readdir(directory).catch(() => [] as string[])
  for (const file of files) if (file.endsWith(".json")) {
    try {
      return JSON.parse(await fs.readFile(path.join(directory, file), "utf8"))
    } catch {}
  }
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
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0)
      if (buffer.length < 4 + length) return
      const frame = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8"))
      buffer = buffer.subarray(4 + length)
      if (frame?.type === "rpc" && frame.message?.id === 1) {
        socket.end()
        resolve(frame.message.result)
        return
      }
    }
  })
  const body = Buffer.from(JSON.stringify({ type: "rpc", message: { id: 1, jsonrpc: "2.0", method, params: {} } }))
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  socket.write(Buffer.concat([header, body]))
  return promise
}

if (backend === "extension") {
  const port = await freePort()
  const started = Date.now()
  hub = Bun.spawn([binary, "browser", "hub", "--loopback", "--port", String(port)], {
    cwd: root,
    env,
    stderr: "pipe",
    stdout: "pipe",
  })
  const tap = (stream: ReadableStream<Uint8Array>) => {
    void (async () => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hubLog.text += decoder.decode(value, { stream: true })
      }
    })()
  }
  tap(hub.stdout)
  tap(hub.stderr)
  const entry = await (async () => {
    for (let i = 0; i < 300; i += 1) {
      const found = await readEntry()
      if (found) return found
      await Bun.sleep(50)
    }
    throw new Error("hub did not start")
  })()
  const answer = await hubRequest(entry.socket, "pairing.url")
  const cdp = await context.newCDPSession(panel)
  await cdp.send("Target.createTarget", { newWindow: true, url: answer.url })
  for (let i = 0; i < 600; i += 1) {
    const current = await readEntry()
    if (current?.paired === true) break
    await Bun.sleep(50)
  }
  pairingMs = Date.now() - started
}

if (backend === "playwright") {
  const install = Bun.spawn([binary, "browser", "install-chromium"], { cwd: root, env, stderr: "pipe", stdout: "pipe", timeout: 600_000 })
  const [out, err, code] = await Promise.all([
    new Response(install.stdout as ReadableStream).text(),
    new Response(install.stderr as ReadableStream).text(),
    install.exited,
  ])
  console.error(`install-chromium exit ${code}: ${(out + err).slice(-300)}`)
}

const spawned = Date.now()
const child = Bun.spawn(
  [binary, "run", "Measure the browser performance.", "--model", "local/echo", "--standalone", "--format", "json"],
  { cwd: root, env, stderr: "pipe", stdout: "pipe", timeout: 600_000 },
)
const [stdout, stderr, code] = await Promise.all([
  new Response(child.stdout as ReadableStream).text(),
  new Response(child.stderr as ReadableStream).text(),
  child.exited,
])
const firstToolAt = (() => {
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue
    try {
      const event = JSON.parse(line)
      if (event?.type === "tool_use" && event.part?.type === "tool" && typeof event.part.state?.time?.start === "number")
        return event.part.state.time.start
    } catch {}
  }
  return undefined
})()

if (backend === "extension") {
  busyHeap = await swHeap(panel)
  try {
    hub.kill("SIGTERM")
  } catch {}
}

const all = samples(stdout)
const sequence = ["browser_navigate", "browser_snapshot", "browser_click", "browser_take_screenshot"]
// #16317 routes every browser call through `execute`; the scripted order names each sample.
if (all.length > 0 && all.every((sample) => sample.tool === "execute")) {
  all.forEach((sample, index) => {
    sample.tool = mode === "screenshot-plain" || mode === "screenshot-framed" ? (index === 0 ? "browser_navigate" : "browser_take_screenshot") : (sequence[index % 4] ?? sample.tool)
  })
}
const tools = sequence
const timings = Object.fromEntries(
  tools.map((tool) => {
    const values = all.filter((sample) => sample.tool === tool).map((sample) => sample.ms)
    const sizes = all.filter((sample) => sample.tool === tool).map((sample) => sample.bytes)
    return [tool, { count: values.length, medianMs: median(values), p95Ms: percentile(values, 95), medianBytes: median(sizes), maxBytes: Math.max(0, ...sizes) }]
  }),
)
const payloadBytes = sequence.map((tool, index) => ({
  tool,
  median: median(payloads[index] ?? []),
  max: Math.max(0, ...(payloads[index] ?? [])),
}))
const snapshots = payloads[1] ?? []
const screenshots = [...stdout.matchAll(/data:image\/png;base64,[A-Za-z0-9+/=]+/g)].map((match) => match[0].length)
const imageUrls = [...stdout.matchAll(/data:image\/png;base64,[A-Za-z0-9+/=]+/g)].map((match) => match[0])
const fresh =
  mode === "full"
    ? imageUrls.filter((url) => {
        try {
          const image = Png.decode(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"))
          const at = (10 * image.width + 10) * image.channels
          return image.data[at] < 60 && image.data[at + 1] > 200 && image.data[at + 2] < 60
        } catch {
          return false
        }
      }).length
    : undefined
const freshness =
  mode === "full" ? { freshScreenshots: fresh ?? 0, totalScreenshots: imageUrls.length } : undefined
let imageSize: { width: number; height: number } | undefined
try {
  const first = imageUrls[0]
  if (first !== undefined) {
    const image = Png.decode(Buffer.from(first.slice(first.indexOf(",") + 1), "base64"))
    imageSize = { width: image.width, height: image.height }
  }
} catch {}
const activeStable = activeIds.length > 0 && activeIds.every((id) => id === activeIds[0])
const timestamps = all.map((sample) => ({ tool: sample.tool, ms: sample.ms }))
console.log(
  JSON.stringify(
    {
      backend,
      coldStartMs: all[0]?.ms,
      code,
      extensionId,
      firstToolAfterSpawnMs: firstToolAt === undefined ? undefined : firstToolAt - spawned,
      heapAfter: busyHeap,
      heapIdle: idleHeap,
      pairingMs,
      reps,
      payloadBytes,
      screenshotDataUriBytes: screenshots,
      snapshotBytes: { median: median(snapshots), max: Math.max(0, ...snapshots) },
      stderr: stderr.slice(-800),
      timingsMs: timings,
      totalCalls: all.length,
      mode,
      timestamps,
      activeIds,
      activeStable,
      freshness,
      imageSize,
    },
    null,
    2,
  ),
)
fixture.stop(true)
model.stop(true)
// The browser teardown can wait on an open download; the measurement is done and the report is printed.
process.exit(code === 0 ? 0 : 1)
