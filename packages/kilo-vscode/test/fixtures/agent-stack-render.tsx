import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { BackgroundAgent } from "../../webview-ui/src/components/chat/background-agents"

const window = new Window({ url: "http://localhost" })
let vscodeState: unknown
Object.assign(globalThis, {
  acquireVsCodeApi: () => ({
    postMessage: () => {},
    getState: () => vscodeState,
    setState: (next: unknown) => {
      vscodeState = next
    },
  }),
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: window.matchMedia.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})

const { batch, createComponent, createRoot, createSignal } = await import("solid-js")
const { createStore, reconcile } = await import("solid-js/store")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { V2Scope } = await import("../../webview-ui/src/v2/client")
const { createBackgroundJobs } = await import("../../webview-ui/src/v2/background-jobs")
const { useAgentStack } = await import("../../webview-ui/src/components/chat/AgentStack")

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
const agent = (id: string, status: BackgroundAgent["status"]): BackgroundAgent => ({
  id,
  description: id,
  status,
  startedAt: 1,
  waiting: false,
})

// The jobs list is reconciled by ID, as `createBackgroundJobs` does, so a status change mutates the agent in place.
const [store, setStore] = createStore<{ list: BackgroundAgent[] }>({ list: [] })
const set = (list: BackgroundAgent[]) => setStore("list", reconcile(list, { key: "id" }))
const [session, setSession] = createSignal<string | undefined>("ses_parent")

const { stack, dispose } = createRoot((dispose) => ({
  stack: useAgentStack({ session, agents: () => store.list, stop: () => {}, dismiss: () => {} }),
  dispose,
}))
const state = () => stack.items().map((item) => `${item.id}:${item.done ? "done" : "running"}`)

set([agent("ses_a", "running"), agent("ses_b", "running")])
await wait()
assert.deepEqual(state(), ["ses_a:running", "ses_b:running"])

// A finished agent dims in place.
set([agent("ses_a", "completed"), agent("ses_b", "running")])
await wait()
assert.deepEqual(state(), ["ses_a:done", "ses_b:running"])

// Every agent finished: the stack keeps them, so a follow-up message does not lose them.
set([agent("ses_a", "completed"), agent("ses_b", "cancelled")])
await wait(400)
assert.deepEqual(state(), ["ses_a:done", "ses_b:done"])
assert.equal(stack.shown(), true)

// Another session, then back: the finished agents of the session show again, without flashing the previous session's
// avatars onto the new one.
batch(() => {
  setSession("ses_other")
  set([])
})
await wait(10)
assert.deepEqual(state(), [])
batch(() => {
  setSession("ses_parent")
  set([agent("ses_a", "completed"), agent("ses_b", "cancelled")])
})
await wait(450)
assert.deepEqual(state(), ["ses_a:done", "ses_b:done"])
assert.equal(stack.shown(), true)

// A switch whose agents land in the same update keeps them: the reset runs before the new list, never after.
// Each session shows only its own count (1 -> 3 -> 0 -> 2), and clearing one session leaves the others untouched.
batch(() => {
  setSession("ses_next")
  set([agent("ses_c", "completed")])
})
await wait(10)
assert.deepEqual(state(), ["ses_c:done"])
batch(() => {
  setSession("ses_three")
  set([agent("ses_d", "running"), agent("ses_e", "completed"), agent("ses_f", "completed")])
})
await wait(10)
assert.deepEqual(state(), ["ses_d:running", "ses_e:done", "ses_f:done"])
assert.equal(stack.running(), 1)
batch(() => {
  setSession("ses_empty")
  set([])
})
await wait(10)
assert.deepEqual(state(), [])
assert.equal(stack.shown(), false)
batch(() => {
  setSession("ses_parent")
  set([agent("ses_a", "completed"), agent("ses_b", "cancelled")])
})
await wait(10)
assert.deepEqual(state(), ["ses_a:done", "ses_b:done"])

// Cleared agents leave the stack.
set([])
await wait(320)
assert.deepEqual(state(), [])

dispose()

// End-to-end scoping through `createBackgroundJobs`: each session lists only its own subagents, switching never leaks
// one session's agents into another, and clearing finished agents in one session leaves every other session intact.
const serverJobs: Record<string, Array<{ id: string; parentSessionID: string; sessionID: string; title: string; status: "running" | "completed" | "cancelled"; background: boolean; time: { started: number; completed?: number } }>> = {
  ses_one: [
    { id: "c1", parentSessionID: "ses_one", sessionID: "c1", title: "One A", status: "completed", background: true, time: { started: 1, completed: 2 } },
    { id: "c2", parentSessionID: "ses_one", sessionID: "c2", title: "One B", status: "completed", background: true, time: { started: 2, completed: 3 } },
    { id: "c3", parentSessionID: "ses_one", sessionID: "c3", title: "One C", status: "running", background: true, time: { started: 3 } },
  ],
  ses_two: [
    { id: "d1", parentSessionID: "ses_two", sessionID: "d1", title: "Two A", status: "completed", background: true, time: { started: 4, completed: 5 } },
  ],
  ses_zero: [],
}

const [activeSession, setActiveSession] = createSignal<string | undefined>("ses_one")
const fakeV2 = {
  directory: "/repo",
  connection: { status: () => "connected" as const },
  report: () => {},
  api: {
    rpc: () => ({
      list: async ({ sessionID }: { sessionID: string }) => ({ jobs: serverJobs[sessionID] ?? [] }),
      cancel: async () => true,
      promote: async () => true,
      events: { on: () => () => {} },
    }),
    session: { interrupt: async () => {} },
  },
  data: {
    session: {
      get: () => undefined,
      message: { list: () => [] },
      permission: { list: () => [] },
      form: { list: () => [] },
      status: (id: string) => (id === "c3" ? "running" : "idle"),
    },
  },
}
const fakeLanguage = {
  locale: () => "en" as const,
  setLocale: () => {},
  userOverride: () => "" as const,
  t: (key: string) => key,
}

let scoped!: { jobs: ReturnType<typeof createBackgroundJobs>; stack: ReturnType<typeof useAgentStack>; dispose: () => void }
createRoot((disposeScoped) => {
  createComponent(LanguageContext.Provider, {
    value: fakeLanguage as never,
    get children() {
      return createComponent(V2Scope, {
        value: fakeV2 as never,
        get children() {
          const jobs = createBackgroundJobs({ session: activeSession })
          const stack = useAgentStack({
            session: activeSession,
            agents: jobs.agents,
            stop: jobs.cancel,
            dismiss: jobs.dismiss,
          })
          scoped = { jobs, stack, dispose: disposeScoped }
          return null
        },
      })
    },
  })
})

const scopedState = () => scoped.stack.items().map((item) => `${item.id}:${item.done ? "done" : "running"}`)

await wait(20)
assert.deepEqual(scopedState(), ["c3:running", "c1:done", "c2:done"])
assert.equal(scoped.jobs.agents().length, 3)

// Switch to a session with 1 subagent: shows 1, never 3.
setActiveSession("ses_two")
assert.equal(scoped.jobs.jobs().length, 0)
await wait(20)
assert.deepEqual(scopedState(), ["d1:done"])
assert.equal(scoped.jobs.agents().length, 1)

// Switch to a session with 0 subagents: shows 0 and hides the stack.
setActiveSession("ses_zero")
await wait(20)
assert.deepEqual(scopedState(), [])
assert.equal(scoped.stack.shown(), false)

// Switch back to session 1: all 3 subagents return.
setActiveSession("ses_one")
await wait(20)
assert.deepEqual(scopedState(), ["c3:running", "c1:done", "c2:done"])

// Clear finished in session 1: hides c1 and c2 in session 1, keeps running c3, and leaves session 2 untouched.
scoped.jobs.dismiss(["c1", "c2"])
await wait(320)
assert.deepEqual(scopedState(), ["c3:running"])

setActiveSession("ses_two")
await wait(20)
assert.deepEqual(scopedState(), ["d1:done"])

setActiveSession("ses_one")
await wait(20)
assert.deepEqual(scopedState(), ["c3:running"])

scoped.dispose()
console.log("agent stack render ok")
