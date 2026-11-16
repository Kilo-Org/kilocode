// The background-jobs and sandbox stores on a mocked server whose Location starts without its plugins: the Kilo RPCs
// answer `rpc.unavailable` until an inventory read lists a plugin, as on a real server. `KILO_COLD_SCENARIO` names the
// store and the case, and the process exits with a failed assertion when the store does not handle it.
import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
// The webview message guard compares the event origin with the window origin, and happy-dom's Window does not
// expose `origin` on its own.
Object.defineProperty(window, "origin", { configurable: true, value: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  Event: window.Event,
  MessageEvent: window.MessageEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: window.matchMedia.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  acquireVsCodeApi: () => ({
    // The host answers the sandbox default of a draft; the user has not chosen one.
    postMessage: (message: { type: string }) => {
      if (message.type !== "requestSandboxDefault") return
      setTimeout(() => post({ type: "sandboxDefaultLoaded" }, window), 5)
    },
    getState: () => undefined,
    setState: () => undefined,
  }),
})

const { createComponent, createRoot, createSignal } = await import("solid-js")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { V2Scope } = await import("../../webview-ui/src/v2/client")
const { createBackgroundJobs } = await import("../../webview-ui/src/v2/background-jobs")
const { createSandbox } = await import("../../webview-ui/src/v2/sandbox")
const { post } = await import("../../webview-ui/src/utils/webview-message")

const [store, scenario] = (process.env.KILO_COLD_SCENARIO ?? "").split(":")
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => boolean, label: string, timeout = 2_000) {
  for (const deadline = Date.now() + timeout; Date.now() < deadline; await sleep(10)) if (check()) return
  throw new Error(`not reached: ${label}; calls: ${calls.join(", ")}`)
}

// The server: `kilo` is false without the plugin, `warm` is the inventory read that first lists the plugins, and an
// offline server fails every request, as a dropped connection does.
const unavailable = { type: "rpc.unavailable", message: "RPC is unavailable" }
const server = {
  kilo: scenario !== "unsupported",
  warm: scenario === "cold" ? 3 : scenario === "unsupported" ? 1 : Number.POSITIVE_INFINITY,
  lists: 0,
  listed: false,
  online: true,
}
const calls: string[] = []
const count = (name: string) => calls.filter((call) => call === name).length
const reports: unknown[] = []
const method =
  <T,>(name: string, value: T) =>
  async () => {
    calls.push(name)
    if (!server.online) throw new TypeError("fetch failed")
    if (!server.kilo || !server.listed) throw unavailable
    return value
  }
const job = {
  id: "ses_child",
  parentSessionID: "ses_parent",
  sessionID: "ses_child",
  title: "Child",
  status: "running",
  background: true,
  time: { started: 1 },
}
const [status, setStatus] = createSignal<"connected" | "reconnecting">("connected")
const v2 = {
  directory: "/workspace",
  connection: { status },
  report: (error: unknown) => reports.push(error),
  api: {
    plugin: {
      list: async () => {
        calls.push("plugin.list")
        if (!server.online) throw new TypeError("fetch failed")
        server.lists++
        server.listed = server.lists >= server.warm
        return { data: server.listed ? [{ id: "opencode.plan" }] : [] }
      },
    },
    rpc: () => ({
      list: method("list", { jobs: [job] }),
      support: method("support", { enabled: true, available: true, network: false }),
      status: method("status", { directory: "/workspace", enabled: true, available: true, network: false, version: 1 }),
      events: { on: () => () => {} },
    }),
    session: { interrupt: async () => {} },
  },
  data: {
    on: () => () => {},
    session: {
      get: () => undefined,
      message: { list: () => [] },
      permission: { list: () => [] },
      form: { list: () => [] },
      status: () => "idle",
    },
  },
}
const language = {
  locale: () => "en" as const,
  setLocale: () => {},
  userOverride: () => "" as const,
  t: (key: string) => key,
}

// The sandbox of a draft is the unsupported case: the first prompt reads its metadata and must not wait.
const session = store === "sandbox" && scenario === "unsupported" ? undefined : "ses_parent"
const mounted = createRoot((dispose) => {
  const stores: { jobs?: ReturnType<typeof createBackgroundJobs>; sandbox?: ReturnType<typeof createSandbox> } = {}
  createComponent(VSCodeProvider, {
    get children() {
      return createComponent(LanguageContext.Provider, {
        value: language as never,
        get children() {
          return createComponent(V2Scope, {
            value: v2 as never,
            get children() {
              if (store === "background-jobs") stores.jobs = createBackgroundJobs({ session: () => session })
              if (store === "sandbox") stores.sandbox = createSandbox({ session: () => session })
              return null
            },
          })
        },
      })
    },
  })
  return { dispose, ...stores }
})

// The reads of the store, and whether it holds the data of the server.
const reads = store === "sandbox" ? (session ? ["support", "status"] : ["support"]) : ["list"]
const loaded = () => {
  if (mounted.jobs) return mounted.jobs.jobs().length === 1
  return mounted.sandbox?.visible() === true && mounted.sandbox.ready() === true
}
/** No request is issued any more. */
async function quiet() {
  await sleep(150)
  const settled = calls.length
  await sleep(300)
  assert.equal(calls.length, settled, `still calling: ${calls.join(", ")}`)
}

if (scenario === "cold") {
  // The Location lists its plugins on the third inventory read; each read asks once more and ends with the data.
  await until(loaded, "data of a Location that was still activating")
  for (const read of reads) assert.equal(count(read), 2, `${read}: ${calls.join(", ")}`)
  await quiet()
}

if (scenario === "unsupported") {
  // The plugins are listed and the RPC is still unavailable: one inventory read and one more RPC read, then quiet.
  await until(() => reads.every((read) => count(read) === 2), "second read")
  await quiet()
  for (const read of reads) assert.equal(count(read), 2, `${read}: ${calls.join(", ")}`)
  assert.equal(count("plugin.list"), reads.length)
  assert.equal(loaded(), false)
  if (mounted.jobs) assert.deepEqual(mounted.jobs.jobs(), [])
  if (mounted.sandbox) {
    const metadata = await Promise.race([mounted.sandbox.metadata(), sleep(1_000).then(() => "waiting" as const)])
    assert.deepEqual(metadata, { "kilocode.sandbox": { enabled: false, version: 0 } })
    assert.equal(mounted.sandbox.visible(), false)
  }
}

if (scenario === "dropped") {
  // The connection drops while the Location activates: the wait ends, and the next connection reads again.
  await until(() => count("plugin.list") >= 2, "inventory wait")
  server.online = false
  setStatus("reconnecting")
  await quiet()
  for (const read of reads) assert.equal(count(read), 1, `${read}: ${calls.join(", ")}`)
  assert.equal(loaded(), false)
  server.online = true
  server.warm = 0
  setStatus("connected")
  await until(loaded, "data after the reconnect")
}

if (scenario === "disposed") {
  await until(() => count("plugin.list") >= 2, "inventory wait")
  mounted.dispose()
  await quiet()
  for (const read of reads) assert.equal(count(read), 1, `${read}: ${calls.join(", ")}`)
}

assert.deepEqual(reports, [])
if (scenario !== "disposed") mounted.dispose()
console.log(`${store}:${scenario} ok (${calls.join(", ")})`)
process.exit(0)
