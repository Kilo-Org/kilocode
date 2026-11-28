import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver,
  Event: window.Event,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})

const { render } = await import("solid-js/web")
const { createSignal } = await import("solid-js")
const { createReopen } = await import("../../webview-ui/agent-manager/new-worktree-draft")

const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

function mount(start: Record<string, unknown>, ready = false) {
  let state = start
  let opens = 0
  const [loaded, setLoaded] = createSignal(ready)
  const [arrived, setArrived] = createSignal(ready)
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(() => {
    createReopen({
      loaded,
      arrived,
      state: () => state,
      save: (next) => {
        state = next
      },
      open: () => {
        opens++
      },
    })
    return null
  }, host)
  return {
    setLoaded,
    setArrived,
    open: () => opens,
    state: () => state,
    set: (next: Record<string, unknown>) => {
      state = next
    },
    dispose,
  }
}

// The page that clicks Reload has already had its one chance, even without a flag.
const old = mount({ advancedDialogDraft: { project: "p1" } })
old.setLoaded(true)
old.setArrived(true)
await flush()
assert.equal(old.open(), 0)
old.set({ advancedDialogReopen: true, advancedDialogDraft: { project: "p1" } })
old.setArrived(false)
old.setArrived(true)
await flush()
assert.equal(old.open(), 0)
assert.equal(old.state().advancedDialogReopen, true)
old.dispose()

// The reloaded page waits for the project list before it opens and clears the flag.
const next = mount({ advancedDialogReopen: true, advancedDialogDraft: { project: "p1" } })
next.setLoaded(true)
await flush()
assert.equal(next.open(), 0)
assert.equal(next.state().advancedDialogReopen, true)
next.setArrived(true)
await flush()
assert.equal(next.open(), 1)
assert.deepEqual(next.state(), { advancedDialogDraft: { project: "p1" } })
next.dispose()

// A reload with a warm state can already have loaded+arrived at mount; it still opens once.
const warm = mount({ advancedDialogReopen: true, advancedDialogDraft: { project: "p1" } }, true)
await flush()
assert.equal(warm.open(), 1)
assert.deepEqual(warm.state(), { advancedDialogDraft: { project: "p1" } })
warm.dispose()

await window.happyDOM.abort()
window.close()
