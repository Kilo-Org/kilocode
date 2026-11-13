// Mounts the v2 data layer of the sidebar on a real server: the real client, the real event stream connection and the
// real directory scope, as `webview-ui/src/v2/client.tsx` builds them, minus the host relay. One store is created
// under that scope, as the session view creates it, and every Kilo RPC answer is recorded. The server, the directory
// and the store come from the environment; the result is one JSON line on stdout.
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

const { OpenCode } = await import("@opencode/client")
const { createClientConnection } = await import("@opencode/client/solid")
const { createComponent, createRoot } = await import("solid-js")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { V2Scope } = await import("../../webview-ui/src/v2/client")
const { events } = await import("../../webview-ui/src/v2/events")
const { createV2Scope } = await import("../../webview-ui/src/v2/scope")
const { createBackgroundJobs } = await import("../../webview-ui/src/v2/background-jobs")
const { createSandbox } = await import("../../webview-ui/src/v2/sandbox")
const { post } = await import("../../webview-ui/src/utils/webview-message")

const env = process.env
const store = env.KILO_COLD_STORE
const directory = env.KILO_COLD_DIRECTORY ?? ""
const session = env.KILO_COLD_SESSION || undefined
const started = performance.now()
const elapsed = () => Math.round(performance.now() - started)

type Call = { rpc: string; method: string; at: number; ok: boolean; type?: string }
const calls: Call[] = []
const real = OpenCode.make({
  baseUrl: env.KILO_COLD_URL ?? "",
  headers: { authorization: env.KILO_COLD_AUTHORIZATION ?? "" },
})
// The same client, with the answer of every Kilo RPC method recorded.
const recorded = (definition: { id: string }) => {
  const rpc = real.rpc(definition as never) as Record<string, unknown>
  const methods = Object.entries(rpc).flatMap(([method, value]) => {
    if (typeof value !== "function") return []
    const call = (...args: unknown[]) =>
      (value as (...args: unknown[]) => Promise<unknown>)(...args).then(
        (result) => {
          calls.push({ rpc: definition.id, method, at: elapsed(), ok: true })
          return result
        },
        (error: unknown) => {
          const type = (error as { type?: string } | undefined)?.type
          calls.push({ rpc: definition.id, method, at: elapsed(), ok: false, type })
          throw error
        },
      )
    return [[method, call] as const]
  })
  return { ...rpc, ...Object.fromEntries(methods) }
}
const api = { ...real, rpc: Object.assign(recorded, real.rpc) } as unknown as typeof real

const language = {
  locale: () => "en" as const,
  setLocale: () => {},
  userOverride: () => "" as const,
  t: (key: string) => key,
}

const mounted = createRoot((dispose) => {
  const event = events()
  const connection = createClientConnection(api, { onEvent: event.emit, pageLifecycle: true })
  const scope = createV2Scope({
    api,
    connection,
    event,
    directory,
    bindings: () => ({}),
    selection: () => false,
    onCommand: () => {},
    open: () => {},
  })
  const stores: { jobs?: ReturnType<typeof createBackgroundJobs>; sandbox?: ReturnType<typeof createSandbox> } = {}
  createComponent(VSCodeProvider, {
    get children() {
      return createComponent(LanguageContext.Provider, {
        value: language as never,
        get children() {
          return createComponent(V2Scope, {
            value: scope,
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
  return { dispose, connection, scope, stores }
})

const succeeded = (rpc: string, method: string) =>
  calls.some((call) => call.rpc === rpc && call.method === method && call.ok)
const done = () => {
  // The handshake version shows that the Location registered its plugins, so a store had the time to read.
  if (mounted.scope.version() === "") return false
  if (store === "wakeups") return succeeded("kilocode.wakeup", "pending")
  if (store === "background-jobs") return succeeded("kilocode.background-jobs", "list")
  return mounted.stores.sandbox?.ready() === true
}

const WAIT = 10_000
const reached = { connected: -1, version: -1 }
for (
  const deadline = performance.now() + WAIT;
  performance.now() < deadline;
  await new Promise((r) => setTimeout(r, 20))
) {
  if (reached.connected < 0 && mounted.connection.status() === "connected") reached.connected = elapsed()
  if (reached.version < 0 && mounted.scope.version() !== "") reached.version = elapsed()
  if (done()) break
}

const result = {
  store,
  session,
  connectedAt: reached.connected,
  versionAt: reached.version,
  version: mounted.scope.version(),
  handshake: mounted.scope.handshake(),
  failure: mounted.scope.failure(),
  sandbox: mounted.stores.sandbox
    ? {
        ready: mounted.stores.sandbox.ready(),
        available: mounted.stores.sandbox.available(),
        disabled: mounted.stores.sandbox.disabled(),
      }
    : undefined,
  calls,
}
mounted.dispose()
console.log(`RESULT ${JSON.stringify(result)}`)
process.exit(0)
