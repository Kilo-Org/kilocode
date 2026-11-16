// Mounts the Agent Manager main surface with a reactive Solid build. A session that becomes the current one (Fork
// Session, a History click, a new tab or a ready worktree) must replace a main terminal tab, and a terminal of the
// context the selection left must not stay active.
import assert from "node:assert/strict"
import { createRoot, createSignal } from "solid-js"
import { createMainSurface } from "../../webview-ui/agent-manager/focus"

// Effects start once the root returns, as they do after the panel mounts.
const scene = createRoot((dispose) => {
  const [active, setActive] = createSignal<string | undefined>("terminal:local")
  const [key, setKey] = createSignal<string | undefined>("p:local")
  const [session, setSession] = createSignal<string | undefined>()
  const contexts: Record<string, string> = { "terminal:local": "p:local", "terminal:wt": "p:wt-1" }
  const surface = createMainSurface({
    terms: {
      activeId: active,
      setActiveId: (id: undefined) => setActive(id),
      contextFor: (id: string) => contexts[id],
      currentKey: key,
      requestFocus: () => undefined,
    },
    covered: () => false,
    session,
    prompt: () => undefined,
  })
  return { dispose, surface, active, setActive, setKey, setSession }
})
const { surface, active, setActive, setKey, setSession } = scene
{
  assert.equal(surface.terminal(), "terminal:local")

  setSession("ses_fork")
  assert.equal(active(), undefined, "a selected session replaces the main terminal tab")

  setSession(undefined)
  setActive("terminal:local")
  assert.equal(active(), "terminal:local", "activating a terminal clears the session and keeps the terminal")

  setKey("p:wt-1")
  assert.equal(active(), undefined, "the terminal of the context the selection left is dropped")

  setActive("terminal:wt")
  setKey("p:wt-1")
  assert.equal(active(), "terminal:wt")
  scene.dispose()
}
process.exit(0)
