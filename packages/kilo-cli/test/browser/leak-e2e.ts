#!/usr/bin/env bun
// Temporary leak check: 400 mixed cycles on one CLI session, forcing GC on the extension service worker every
// 50 cycles and reading used heap; heap snapshots at cycle 100 and 300 when the usage keeps growing.
import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"

const binaryInput = process.argv[2]
const cycles = Number(process.argv[3] ?? "400")
if (!binaryInput) throw new Error("usage: bun leak-e2e.ts <kilo2> [cycles]")
const binary = path.resolve(binaryInput)

const pluginDirectory = path.resolve(import.meta.dirname, "../../../kilo-plugin")
const playwright: any = await import(Bun.resolveSync("playwright-core", pluginDirectory))
const extensionDirectory = process.env.E2E_EXTENSION_DIR ?? ""

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Leak</title></head>
<body>
  <h1>Leak</h1>
  <button id="go">Click me</button>
  <p id="status">idle</p>
  <script>document.getElementById("go").addEventListener("click", () => {
    document.getElementById("status").textContent = "clicked"
    document.body.style.background = "#00ff00"
  })</script>
</body></html>`

const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
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
          {
            function: { arguments: JSON.stringify(args), name },
            id: `call_${name}_${Date.now()}`,
            index: 0,
            type: "function",
          },
        ],
      },
      null,
    ),
    chunk(model, {}, "tool_calls"),
    "data: [DONE]\n\n",
  ].join("")
const answer = (model: string, text: string) =>
  [chunk(model, { content: text, role: "assistant" }, null), chunk(model, {}, "stop"), "data: [DONE]\n\n"].join("")

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined
const textOf = (content: unknown): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .flatMap((part) => {
      const type = field(part, "type")
      const text = field(part, "text")
      return type === "text" && typeof text === "string" ? [text] : []
    })
    .join("\n")
}
const readResults = (messages: unknown) => {
  const results: string[] = []
  if (!Array.isArray(messages)) return results
  for (const message of messages) if (field(message, "role") === "tool") results.push(textOf(field(message, "content")))
  return results
}

const total = cycles * 4
const series: { cycle: number; used: number; total: number }[] = []
let snapshotA: string | undefined
let snapshotB: string | undefined
let sampleHeap: ((cycle: number) => Promise<void>) | undefined
let takeSnapshot: (() => Promise<string>) | undefined

const sse = (body: string) => new Response(body, { headers: { "content-type": "text/event-stream" } })
const model = Bun.serve({
  hostname: "127.0.0.1",
  // No idle timeout: a request waits while the worker's heap is sampled or snapshotted, which can outlast Bun's 10 s.
  idleTimeout: 0,
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
    const body: unknown = await request.json()
    const name = typeof field(body, "model") === "string" ? String(field(body, "model")) : "local"
    const results = readResults(field(body, "messages"))
    const i = results.length
    if (i >= total) return sse(answer(name, "done"))
    if (i > 0 && i % 200 === 0 && sampleHeap) await sampleHeap(i / 4)
    if (i === 400 && takeSnapshot) snapshotA = await takeSnapshot()
    if (i === 1200 && takeSnapshot) snapshotB = await takeSnapshot()
    const phase = i % 4
    if (phase === 0) return sse(toolCall(name, "browser_navigate", { url: origin }))
    if (phase === 1) return sse(toolCall(name, "browser_snapshot", {}))
    if (phase === 2) {
      const ref = /button "Click me" \[ref=([^\]]+)\]/.exec(results[i - 1] ?? "")?.[1]
      return sse(toolCall(name, "browser_click", { element: "the button", target: ref ?? "e1" }))
    }
    return sse(toolCall(name, "browser_take_screenshot", { scale: "css", type: "png" }))
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

const config = {
  model: "local/echo",
  providers: {
    local: {
      models: { echo: { limit: { context: 200_000, output: 4_000 }, name: "Echo" } },
      name: "Local",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { apiKey: "local-key", baseURL: `${model.url.origin}/v1` },
    },
  },
  browser: { backend: "extension", observation: "full", headless: false },
  permissions: [{ action: "*", effect: "allow", resource: "*" }],
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), "leak-bridge-"))
const root = path.join(base, "run")
await fs.mkdir(path.join(root, "bin"), { recursive: true })
await fs.mkdir(path.join(root, "run"), { recursive: true, mode: 0o700 })
await fs.writeFile(path.join(root, "bin", "xdg-open"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })

// The accepted downloads state (automation cannot answer Chrome's optional-permission prompt).
const loaded = path.join(base, "extension-downloads")
await fs.cp(extensionDirectory, loaded, { recursive: true })
const manifestPath = path.join(loaded, "manifest.json")
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
  optional_permissions?: string[]
  permissions?: string[]
}
const optional = (manifest.optional_permissions ?? []).filter((permission) => permission !== "downloads")
const permissions = [...(manifest.permissions ?? [])]
if (!permissions.includes("downloads")) permissions.push("downloads")
await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, optional_permissions: optional, permissions }, null, 2))

const context = await playwright.chromium.launchPersistentContext(path.join(base, "profile"), {
  args: [
    `--disable-extensions-except=${loaded}`,
    `--load-extension=${loaded}`,
    "--disable-blink-features=AutomationControlled",
  ],
  executablePath: playwright.chromium.executablePath(),
  headless: false,
  ignoreDefaultArgs: ["--enable-automation"],
  viewport: { height: 900, width: 1280 },
})
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
const extensionId = new URL(worker.url()).host

// User tab so the agent's tab is never the active one.
const userTab = await context.newPage()
await userTab.goto(`${origin}/?user=1`)

await context.route("https://app.kilo.ai/api/user", (route: any) =>
  route.fulfill({ json: { google_user_email: "leak@kilo.ai" }, status: 200 }),
)
await context.route("https://app.kilo.ai/api/organizations", (route: any) =>
  route.fulfill({ json: { organizations: [] }, status: 200 }),
)
await context.route(
  (url: URL) => url.origin === "https://app.kilo.ai" && url.pathname.startsWith("/api/trpc/"),
  (route: any) => route.fulfill({ json: {}, status: 200 }),
)
await context.addInitScript({
  content: "Object.defineProperty(chrome.permissions, 'request', { value: () => Promise.resolve(true) });",
})
const panel = await context.newPage()
await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
await panel.evaluate(
  () =>
    new Promise<void>((resolve, reject) => {
      const global = globalThis as {
        chrome?: {
          runtime?: { lastError?: { message?: string } }
          storage?: { local?: { set(items: Record<string, unknown>, callback: () => void): void } }
        }
      }
      const api = global.chrome
      if (!api?.storage?.local) return reject(new Error("no storage"))
      api.storage.local.set({ kiloAuth: { token: "token-1", userEmail: "leak@kilo.ai" } }, () => {
        const message = api.runtime?.lastError?.message
        if (message) reject(new Error(message))
        else resolve()
      })
    }),
)
await panel.reload()
await panel.getByRole("button", { name: "Settings" }).click()
await panel.getByRole("switch", { name: "Allow local agents" }).click()
await Bun.sleep(500)

class SwProbe {
  private session: any
  private sessionId = ""
  private nextId = 1
  private pending = new Map<number, { resolve: (message: any) => void; reject: (error: Error) => void }>()
  private chunks: string[] = []
  private collecting = false

  async attach() {
    const browser = context.browser()
    if (!browser) throw new Error("no browser")
    this.session = await browser.newBrowserCDPSession()
    const { targetInfos } = await this.session.send("Target.getTargets")
    const target = targetInfos.find(
      (info: any) => info.type === "service_worker" && String(info.url).includes(extensionId),
    )
    if (!target) throw new Error("no service worker target")
    const { sessionId } = await this.session.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: false,
    })
    this.sessionId = sessionId
    this.session.on("Target.receivedMessageFromTarget", (event: any) => {
      if (event.sessionId !== this.sessionId) return
      let message: any
      try {
        message = JSON.parse(event.message)
      } catch {
        return
      }
      if (message.method === "HeapProfiler.addHeapSnapshotChunk") {
        if (this.collecting) this.chunks.push(message.params.chunk)
        return
      }
      const waiter = this.pending.get(message.id)
      if (waiter) {
        this.pending.delete(message.id)
        if (message.error) waiter.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`))
        else waiter.resolve(message)
      }
    })
  }

  /** One CDP call on the worker; rejects on a CDP error, a failed send or no answer within `timeoutMs`. */
  private send(method: string, params: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<any> {
    const id = this.nextId++
    const { promise, resolve, reject } = Promise.withResolvers<any>()
    const timer = setTimeout(() => reject(new Error(`CDP ${method}: no answer within ${timeoutMs} ms`)), timeoutMs)
    this.pending.set(id, { reject, resolve })
    this.session
      .send("Target.sendMessageToTarget", { sessionId: this.sessionId, message: JSON.stringify({ id, method, params }) })
      .catch(reject)
    return promise.finally(() => {
      clearTimeout(timer)
      this.pending.delete(id)
    })
  }

  async heap(): Promise<{ used: number; total: number }> {
    await this.send("HeapProfiler.collectGarbage")
    const usage = await this.send("Runtime.getHeapUsage")
    if (typeof usage.result?.usedSize !== "number") throw new Error(`Runtime.getHeapUsage returned no heap size: ${JSON.stringify(usage)}`)
    return { used: usage.result.usedSize, total: usage.result.totalSize }
  }

  async snapshot(): Promise<string> {
    this.chunks = []
    this.collecting = true
    try {
      await this.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: false })
    } finally {
      this.collecting = false
    }
    return this.chunks.join("")
  }
}

const probe = new SwProbe()
await probe.attach()
sampleHeap = async (cycle) => {
  const heap = await probe.heap()
  series.push({ cycle, used: Math.round(heap.used / 1024), total: Math.round(heap.total / 1024) })
}
takeSnapshot = () => probe.snapshot()
await sampleHeap(0)

const env = {
  ...process.env,
  HOME: root,
  KILO_API_KEY: "",
  KILO_AUTH_CONTENT: "",
  KILO_BROWSER_DATA_DIR: path.join(root, "data", "kilo2", "browser"),
  KILO_BROWSER_EXTRA_EXTENSION_IDS: extensionId,
  KILO_BROWSER_RUN_DIR: path.join(root, "run", "browser"),
  KILO_CONFIG_CONTENT: JSON.stringify(config),
  KILO_DISABLE_AUTOUPDATE: "1",
  KILO_DISABLE_MODELS_FETCH: "1",
  PATH: `${path.join(root, "bin")}:${process.env.PATH ?? ""}`,
  XDG_CACHE_HOME: path.join(root, "cache"),
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_RUNTIME_DIR: path.join(root, "run"),
  XDG_STATE_HOME: path.join(root, "state"),
}

const hubPort = await freePort()
const hub = Bun.spawn([binary, "browser", "hub", "--loopback", "--port", String(hubPort)], {
  cwd: root,
  env,
  stderr: "pipe",
  stdout: "pipe",
})
const hubLog = { text: "" }
for (const stream of [hub.stdout, hub.stderr]) {
  void (async () => {
    const reader = (stream as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hubLog.text += decoder.decode(value, { stream: true })
    }
  })()
}

async function readEntry() {
  const directory = path.join(root, "run", "browser", "hubs")
  const files = await fs.readdir(directory).catch(() => [] as string[])
  for (const file of files)
    if (file.endsWith(".json")) {
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

/** Stops the hub and the browser and removes the scratch root; every way out after the launch goes through it. */
async function teardown(exitCode: number): Promise<never> {
  hub.kill("SIGTERM")
  await Promise.race([hub.exited, Bun.sleep(5_000)])
  if (hub.exitCode === null && hub.signalCode === null) hub.kill("SIGKILL")
  await Promise.race([context.close().catch(() => undefined), Bun.sleep(10_000)])
  fixture.stop(true)
  model.stop(true)
  await fs.rm(base, { force: true, recursive: true }).catch(() => undefined)
  process.exit(exitCode)
}

const entry = await (async () => {
  for (let i = 0; i < 300; i += 1) {
    const found = await readEntry()
    if (found) return found
    await Bun.sleep(50)
  }
  throw new Error("hub did not start")
})()
const pairing = await hubRequest(entry.socket, "pairing.url")
const cdp = await context.newCDPSession(panel)
await cdp.send("Target.createTarget", { newWindow: true, url: pairing.url })
let paired = false
for (let i = 0; i < 600 && !paired; i += 1) {
  paired = (await readEntry())?.paired === true
  if (!paired) await Bun.sleep(50)
}
if (!paired) {
  console.log(JSON.stringify({ error: "the extension did not pair with the hub within 30 s", hubLog: hubLog.text.slice(-800) }, null, 2))
  await teardown(1)
}

const started = Date.now()
const child = Bun.spawn([binary, "run", "Leak check.", "--model", "local/echo", "--standalone", "--format", "json"], {
  cwd: root,
  env,
  stderr: "pipe",
  stdout: "pipe",
  timeout: 3_600_000,
})
// stdout is drained so the pipe never blocks the run; the heap series is the result.
const [, stderr, code] = await Promise.all([
  new Response(child.stdout as ReadableStream).text(),
  new Response(child.stderr as ReadableStream).text(),
  child.exited,
])
await sampleHeap(cycles)

// Snapshot comparison when the measured growth warrants it.
let comparison: { name: string; delta: number }[] | undefined
if (snapshotA !== undefined && snapshotB !== undefined) {
  const parse = (text: string) => {
    const snapshot = JSON.parse(text) as {
      snapshot: { meta: { node_fields: string[]; node_types: [string[], ...unknown[]] } }
      nodes: number[]
      strings: string[]
    }
    const fields = snapshot.snapshot.meta.node_fields
    const kinds = snapshot.snapshot.meta.node_types[0]
    const size = fields.length
    const typeOffset = fields.indexOf("type")
    const nameOffset = fields.indexOf("name")
    const counts = new Map<string, number>()
    for (let i = 0; i < snapshot.nodes.length; i += size) {
      const kind = kinds[snapshot.nodes[i + typeOffset] ?? -1]
      const name = snapshot.strings[snapshot.nodes[i + nameOffset] ?? -1] ?? "?"
      // Objects by constructor name and closures by function name: what a leak keeps alive.
      if (kind !== "object" && kind !== "closure") continue
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return counts
  }
  const before = parse(snapshotA)
  const after = parse(snapshotB)
  const names = new Set([...before.keys(), ...after.keys()])
  comparison = [...names]
    .map((name) => ({ name, delta: (after.get(name) ?? 0) - (before.get(name) ?? 0) }))
    .filter((entry) => entry.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 15)
}

console.log(
  JSON.stringify(
    {
      cycles,
      code,
      durationMs: Date.now() - started,
      hubLog: hubLog.text.slice(-800),
      series,
      snapshots: comparison,
      stderr: stderr.slice(-800),
      startedWithSnapshots: snapshotA !== undefined && snapshotB !== undefined,
    },
    null,
    2,
  ),
)
await teardown(code === 0 ? 0 : 1)
