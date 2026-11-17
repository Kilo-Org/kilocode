// Mounts the Agent Manager main surface with a reactive Solid build. A session that becomes the current one (Fork
// Session, a History click, a new tab or a ready worktree) must replace a main terminal tab, and a terminal of the
// context the selection left must not stay active.
import assert from "node:assert/strict"
import { batch, createRoot, createSignal } from "solid-js"
import { createMainSurface } from "../../webview-ui/agent-manager/focus"

// Effects start once the root returns, as they do after the panel mounts.
const scene = createRoot((dispose) => {
  const [active, setActive] = createSignal<string | undefined>("terminal:local")
  const [key, setKey] = createSignal<string | undefined>("p:local")
  const [session, setSession] = createSignal<string | undefined>()
  const [focused, setFocused] = createSignal<string | undefined>()
  const remembered: unknown[] = []
  const contexts: Record<string, string> = {
    "terminal:local": "p:local",
    "terminal:wt": "p:wt-1",
    "terminal:side": "p:local",
  }
  const surface = createMainSurface({
    terms: {
      activeId: active,
      setActiveId: (id: undefined) => setActive(id),
      contextFor: (id: string) => contexts[id],
      currentKey: key,
      requestFocus: () => undefined,
      focusedId: focused,
      sidesForContext: (key: string) => (key === "p:local" ? [{ id: "terminal:side" }] : []),
    },
    covered: () => false,
    session,
    prompt: () => undefined,
    remember: (owner) => remembered.push(owner),
  })
  return { dispose, surface, active, setActive, setKey, setSession, setFocused, remembered }
})
const { surface, active, setActive, setKey, setSession, setFocused, remembered } = scene
{
  // A focused side terminal is remembered by id, a focused main terminal as the main surface.
  setFocused("terminal:side")
  setFocused("terminal:local")
  assert.deepEqual(remembered, [{ terminal: "terminal:side" }, "prompt"])

  assert.equal(surface.terminal(), "terminal:local")

  setSession("ses_fork")
  assert.equal(active(), undefined, "a selected session replaces the main terminal tab")

  setSession(undefined)
  setActive("terminal:local")
  assert.equal(active(), "terminal:local", "activating a terminal clears the session and keeps the terminal")

  setKey("p:wt-1")
  assert.equal(active(), undefined, "the terminal of the context the selection left is dropped")

  // Switching back restores the destination's terminal tab in the same batch, as the selection actions do.
  batch(() => {
    setKey("p:local")
    setActive("terminal:local")
  })
  assert.equal(active(), "terminal:local", "the terminal of the selected context stays active")
  scene.dispose()
}
process.exit(0)
