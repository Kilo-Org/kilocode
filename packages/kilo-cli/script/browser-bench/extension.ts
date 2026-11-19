/**
 * One Chromium with the built Kilo extension, "Allow local agents" on, paired over loopback with one
 * `kilo2 browser hub --loopback` for the whole benchmark matrix. Each `kilo2 run` that uses `environment()` reaches
 * the same hub through the shared browser run directory, so every task run is its own CLI session on one browser.
 *
 * The launch, settings and pairing steps follow test/browser/extension-e2e.ts.
 */
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import net from "node:net"
import path from "node:path"

declare const chrome: {
  storage: { local: { get(key: string): Promise<unknown> } }
  tabGroups: { query(query: Record<string, unknown>): Promise<unknown> }
  tabs: { query(query: Record<string, unknown>): Promise<unknown> }
}

type Locator = {
  click(): Promise<void>
  getAttribute(name: string): Promise<string | null>
  waitFor(options?: { timeout?: number }): Promise<void>
}

type CdpSession = { send(method: string, params?: Record<string, unknown>): Promise<unknown> }

type Worker = {
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>
  url(): string
}

type Page = {
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>
  getByLabel(label: string): Locator
  getByRole(role: string, options?: { name?: string }): Locator
  goto(url: string): Promise<unknown>
  reload(): Promise<unknown>
  on(event: "dialog", listener: (dialog: unknown) => void): void
  screenshot(options: { path: string }): Promise<unknown>
  setDefaultTimeout(timeout: number): void
}

type Route = { fulfill(options: { json: unknown; status: number }): Promise<void>; request(): { url(): string } }

type Context = {
  addInitScript(script: { content: string }): Promise<void>
  close(): Promise<void>
  newCDPSession(page: Page): Promise<CdpSession>
  newPage(): Promise<Page>
  on(event: "page", listener: (page: Page) => void): void
  pages(): Page[]
  route(url: string | ((url: URL) => boolean), handler: (route: Route) => Promise<void> | void): Promise<void>
  serviceWorkers(): Worker[]
  setDefaultTimeout(timeout: number): void
  waitForEvent(event: string): Promise<Worker>
}

type Playwright = {
  chromium: {
    executablePath(): string
    launchPersistentContext(directory: string, options: Record<string, unknown>): Promise<unknown>
  }
}

type HubEntry = { hubId: string; paired?: boolean; port?: number; socket?: string }

type ChromeExtensionApi = {
  runtime?: { lastError?: { message?: string } }
  storage?: { local?: { set(items: Record<string, unknown>, callback: () => void): void } }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

export async function until<T>(
  check: () => Promise<T | undefined> | T | undefined,
  timeout = 20_000,
  label = "condition",
): Promise<T> {
  const deadline = Date.now() + timeout
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value !== undefined) return value
    } catch (error) {
      last = error
    }
    await Bun.sleep(50)
  }
  throw new Error(`${label} was not met before ${timeout}ms${last === undefined ? "" : `: ${String(last)}`}`)
}

/** Browser directories every run shares with the hub; per-run XDG directories keep the sessions apart. */
export function browserEnvironment(root: string) {
  return {
    KILO_BROWSER_DATA_DIR: path.join(root, "browser-data"),
    KILO_BROWSER_RUN_DIR: path.join(root, "run", "browser"),
    XDG_RUNTIME_DIR: path.join(root, "run"),
  }
}

async function readHubEntry(root: string): Promise<HubEntry | undefined> {
  const directory = path.join(root, "run", "browser", "hubs")
  const files = await fs.readdir(directory).catch(() => [] as string[])
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    try {
      return JSON.parse(await fs.readFile(path.join(directory, file), "utf8")) as HubEntry
    } catch {
      // A half-written registry file is rewritten by the hub; the next read sees it whole.
    }
  }
  return undefined
}

async function freePort(range?: [number, number]): Promise<number> {
  const candidates = range ? Array.from({ length: range[1] - range[0] + 1 }, (_, index) => range[0] + index) : [0]
  for (const candidate of candidates) {
    const { promise, resolve } = Promise.withResolvers<number | undefined>()
    const server = net.createServer()
    server.once("error", () => resolve(undefined))
    server.listen(candidate, "127.0.0.1", () => {
      const address = server.address()
      const value = typeof address === "object" && address !== null ? address.port : undefined
      server.close(() => resolve(value))
    })
    const port = await promise
    if (port !== undefined) return port
  }
  throw new Error(`no free port in ${range?.join("-")}`)
}

/** One JSON-RPC call the hub answers itself, over the 4-byte-framed socket the CLI uses. */
async function hubRequest(socketPath: string, method: string, params: unknown): Promise<unknown> {
  const socket = net.createConnection(socketPath)
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  })
  const { promise, resolve, reject } = Promise.withResolvers<unknown>()
  let buffer = Buffer.alloc(0)
  const timer = setTimeout(() => {
    socket.destroy()
    reject(new Error(`hub ${method} timed out`))
  }, 15_000)
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0)
      if (buffer.length < 4 + length) return
      const text = buffer.subarray(4, 4 + length).toString("utf8")
      buffer = buffer.subarray(4 + length)
      let frame: unknown
      try {
        frame = JSON.parse(text)
      } catch {
        continue
      }
      if (record(frame)?.["type"] !== "rpc") continue
      const message = record(record(frame)?.["message"])
      if (message?.["id"] !== 1) continue
      clearTimeout(timer)
      socket.end()
      const error = record(message["error"])
      if (error) reject(new Error(String(error["message"])))
      else resolve(message["result"])
      return
    }
  })
  socket.once("error", (error: Error) => {
    clearTimeout(timer)
    reject(error)
  })
  const body = Buffer.from(JSON.stringify({ message: { id: 1, jsonrpc: "2.0", method, params }, type: "rpc" }))
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  socket.write(Buffer.concat([header, body]))
  return promise
}

export type ExtensionBrowser = {
  extensionId: string
  /** Environment for `kilo2 run` and the hub: the shared browser directories and the unpacked extension id. */
  environment: () => Record<string, string>
  /** Tabs open in the browser right now, so a run that leaves tabs behind shows in the results. */
  tabCount: () => Promise<number>
  /** Tab group titles right now: each session's group, and how ended sessions leave theirs. */
  groupTitles: () => Promise<string[]>
  /** Restarts and re-pairs the hub when it exited or lost the extension between runs. */
  ensurePaired: () => Promise<{ repaired: boolean }>
  hubLog: () => string
  close: () => Promise<void>
}

/**
 * A copy of the built extension with the optional `downloads` permission promoted to required: the state after the
 * user accepts the prompt "Allow local agents" shows, which automation cannot answer. Without it the extension refuses
 * every download-capable call, navigation included.
 */
async function grantDownloads(source: string, target: string) {
  await fs.rm(target, { recursive: true, force: true })
  await fs.cp(source, target, { recursive: true })
  const manifestPath = path.join(target, "manifest.json")
  const manifest = record(JSON.parse(await fs.readFile(manifestPath, "utf8"))) ?? {}
  const listed = (key: string) => (Array.isArray(manifest[key]) ? manifest[key].map(String) : [])
  const permissions = listed("permissions")
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        ...manifest,
        optional_permissions: listed("optional_permissions").filter((permission) => permission !== "downloads"),
        permissions: permissions.includes("downloads") ? permissions : [...permissions, "downloads"],
      },
      null,
      2,
    ),
  )
  return target
}

export async function launchExtensionBrowser(input: {
  binary: string
  root: string
  extension: string
  chromium?: string
  ports?: [number, number]
  /** Load the shipped manifest, where the optional Downloads permission stays ungranted. */
  ungranted?: boolean
}): Promise<ExtensionBrowser> {
  // playwright-core belongs to the plugin workspace, not this package, so it is resolved from there at runtime: a
  // static import would depend on hoisting the workspace does not promise.
  const pluginDirectory = path.resolve(import.meta.dirname, "../../../kilo-plugin")
  const playwright = (await import(Bun.resolveSync("playwright-core", pluginDirectory))) as unknown as Playwright
  const executablePath = input.chromium ?? playwright.chromium.executablePath()
  await fs.access(path.join(input.extension, "manifest.json"))
  const directory = input.ungranted ? input.extension : await grantDownloads(input.extension, path.join(input.root, "extension"))
  if (!existsSync(executablePath)) throw new Error(`no Chromium at ${executablePath}`)
  await fs.mkdir(path.join(input.root, "run"), { recursive: true, mode: 0o700 })
  await fs.mkdir(path.join(input.root, "bin"), { recursive: true })
  // The CLI's system opener is xdg-open on Linux; a no-op keeps a pairing prompt from opening another browser.
  await fs.writeFile(path.join(input.root, "bin", "xdg-open"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })

  const context = (await playwright.chromium.launchPersistentContext(path.join(input.root, "profile"), {
    args: [
      `--disable-extensions-except=${directory}`,
      `--load-extension=${directory}`,
      "--disable-blink-features=AutomationControlled",
    ],
    executablePath,
    headless: false,
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: { height: 900, width: 1280 },
  })) as unknown as Context
  context.setDefaultTimeout(20_000)
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  const extensionId = new URL(worker.url()).host

  // The settings header only exists for a signed-in session; the API calls it makes are answered locally. A
  // development build talks to localhost:3000 instead of app.kilo.ai, so both origins are answered.
  const api = (url: URL) => url.origin === "https://app.kilo.ai" || url.origin === "http://localhost:3000"
  await context.route(
    (url) => api(url) && url.pathname.startsWith("/api/"),
    (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === "/api/user") return route.fulfill({ json: { google_user_email: "bench@kilo.ai" }, status: 200 })
      if (pathname === "/api/organizations") return route.fulfill({ json: { organizations: [] }, status: 200 })
      return route.fulfill({ json: {}, status: 200 })
    },
  )
  // Automation cannot answer the optional-permission prompt; this grants it the way an accepted prompt would.
  await context.addInitScript({
    content: "Object.defineProperty(chrome.permissions, 'request', { value: () => Promise.resolve(true) });",
  })
  // Playwright dismisses every JavaScript dialog on a page it drives unless the page has a dialog listener, so the
  // extension would never see one open. A listener that does nothing leaves the dialog to the extension, as in a
  // browser no automation drives.
  for (const page of context.pages()) page.on("dialog", () => {})
  context.on("page", (page) => page.on("dialog", () => {}))
  const panel = await context.newPage()
  panel.setDefaultTimeout(20_000)
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await panel.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const api = (globalThis as { chrome?: ChromeExtensionApi }).chrome
        if (!api?.storage?.local) {
          reject(new Error("chrome.storage.local is unavailable"))
          return
        }
        api.storage.local.set({ kiloAuth: { token: "token-1", userEmail: "bench@kilo.ai" } }, () => {
          const message = api.runtime?.lastError?.message
          if (message) reject(new Error(message))
          else resolve()
        })
      }),
  )
  await panel.reload()
  const settings = panel.getByLabel("Settings")
  try {
    await settings.waitFor()
  } catch (error) {
    await panel.screenshot({ path: path.join(input.root, "settings-missing.png") }).catch(() => {})
    throw error
  }
  await settings.click()
  const toggle = panel.getByRole("switch", { name: "Allow local agents" })
  await toggle.waitFor()
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click()
  await until(async () => (await toggle.getAttribute("aria-checked")) === "true", 10_000, "the switch turns on")
  const stored = record(await worker.evaluate(() => chrome.storage.local.get("kiloLocalAgentSettings")))
  if (record(stored?.["kiloLocalAgentSettings"])?.["enabled"] !== true) {
    throw new Error(`"Allow local agents" did not persist: ${JSON.stringify(stored)}`)
  }

  const environment = () => ({
    ...browserEnvironment(input.root),
    KILO_BROWSER_EXTRA_EXTENSION_IDS: extensionId,
    PATH: `${path.join(input.root, "bin")}:${process.env.PATH ?? ""}`,
  })

  let log = ""
  let hub: { exited: Promise<number>; kill(signal?: number | NodeJS.Signals): void; done: boolean } | undefined

  const tap = (stream: ReadableStream<Uint8Array>) =>
    void (async () => {
      const decoder = new TextDecoder()
      try {
        for await (const chunk of stream) {
          log += decoder.decode(chunk, { stream: true })
          if (log.length > 200_000) log = log.slice(-100_000)
        }
      } catch {
        // The stream closes when the hub exits.
      }
    })()

  const startHub = async () => {
    await fs.rm(path.join(input.root, "run", "browser", "hubs"), { recursive: true, force: true })
    const port = await freePort(input.ports)
    const child = Bun.spawn([input.binary, "browser", "hub", "--loopback", "--port", String(port)], {
      cwd: input.root,
      env: { ...process.env, ...environment(), HOME: input.root, KILO_DISABLE_AUTOUPDATE: "1" },
      stderr: "pipe",
      stdout: "pipe",
    })
    const state = { exited: child.exited, kill: (signal?: number | NodeJS.Signals) => child.kill(signal), done: false }
    void child.exited.then(() => (state.done = true))
    hub = state
    tap(child.stdout as ReadableStream<Uint8Array>)
    tap(child.stderr as ReadableStream<Uint8Array>)
    await until(async () => readHubEntry(input.root), 30_000, "the hub registers itself")
  }

  const pair = async () => {
    const entry = await readHubEntry(input.root)
    if (entry?.socket === undefined) throw new Error("the hub registry has no socket")
    const url = record(await hubRequest(entry.socket, "pairing.url", {}))?.["url"]
    if (typeof url !== "string") throw new Error("the hub returned no pairing URL")
    const cdp = await context.newCDPSession(panel)
    // A tab with no opener: the extension redeems the token and closes it.
    await cdp.send("Target.createTarget", { newWindow: true, url })
    await until(
      async () => ((await readHubEntry(input.root))?.paired === true ? true : undefined),
      30_000,
      "the extension pairs and connects",
    )
  }

  const stopHub = async () => {
    if (!hub || hub.done) return
    hub.kill("SIGTERM")
    await Promise.race([hub.exited, Bun.sleep(5_000)])
  }

  await startHub()
  await pair()

  return {
    extensionId,
    environment,
    tabCount: async () => {
      const tabs = await worker.evaluate(() => chrome.tabs.query({}))
      return Array.isArray(tabs) ? tabs.length : -1
    },
    groupTitles: async () => {
      const groups = await worker.evaluate(() => chrome.tabGroups.query({}))
      return Array.isArray(groups) ? groups.map((group) => String(record(group)?.["title"] ?? "")) : []
    },
    ensurePaired: async () => {
      const entry = await readHubEntry(input.root)
      if (hub && !hub.done && entry?.paired === true) return { repaired: false }
      await stopHub()
      await startHub()
      await pair()
      return { repaired: true }
    },
    hubLog: () => log,
    close: async () => {
      await stopHub()
      await context.close().catch(() => {})
    },
  }
}
