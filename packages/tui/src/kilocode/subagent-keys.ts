import { createMemo } from "solid-js"
import { useTuiConfig } from "../config"
import { useExit } from "../context/exit"
import { usePromptRef } from "../context/prompt"
import { useRouteData } from "../context/route"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { KILO_BASE_MODE, useBindings } from "../keymap"
import { useToast } from "../ui/toast"
import { running } from "../util/session"
import { createDoublePress } from "./double-press"
import { KiloSteer } from "./steer"
import { KiloTaskPause } from "./task-pause"

// Bare-arrow parent/sibling navigation. The session route no longer binds these: while a steer is
// typed they must reach the prompt, and the route's layer would outrank the prompt's textarea.
const NAV = ["session.parent", "session.child.next", "session.child.previous"] as const

/**
 * Subagent-view keys: double Esc interrupts this subagent, the configured exit keys need a second
 * press, and the arrows navigate to the parent and siblings. Navigation and exit act on the view
 * only while the steering prompt is unfocused or empty, so a typed steer keeps arrow, ctrl+c
 * (clear) and ctrl+d (delete) editing. Call it from a component that is mounted only for subagent
 * sessions (the subagent footer).
 */
export function useSubagentKeys() {
  const route = useRouteData("session")
  const prompt = usePromptRef()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const exit = useExit()
  const tuiConfig = useTuiConfig()
  const interrupt = createDoublePress(5000)
  const quit = createDoublePress(1000)

  const interruptible = createMemo(() => {
    const status = sync.data.session_status?.[route.sessionID]
    return status ? running(status.type) : false
  })

  // The parent's task waits on the user after an interrupt; a new prompt resumes it.
  const paused = createMemo(() => !interruptible() && KiloTaskPause.paused(sync.session.get(route.sessionID)))

  // An interrupt, like Esc in any session view: it stops this subagent's turn and pauses the
  // parent's task, so background work it started keeps running. A new prompt resumes the task.
  function stop() {
    if (!interrupt.press()) return
    const fail = () => toast.show({ message: "Failed to interrupt subagent", variant: "error" })
    void sdk.client.session.abort({ sessionID: route.sessionID, scope: "session" }).then((res) => {
      if (res.error) fail()
    }, fail)
  }

  // `get` (not `gather`): gather caches by name, so a second gather("session", ...) returns the first list.
  useBindings(() => ({
    mode: KILO_BASE_MODE,
    enabled: interruptible(),
    priority: 1,
    commands: [
      {
        name: "subagent.interrupt",
        title: "Interrupt subagent",
        category: "Session",
        hidden: true,
        run: stop,
      },
    ],
    bindings: tuiConfig.keybinds.get("subagent.interrupt"),
  }))

  // Priority 1 also outranks prompt history, so up on an empty prompt goes to the parent.
  useBindings(() => ({
    mode: KILO_BASE_MODE,
    priority: 1,
    enabled: () => KiloSteer.idle(prompt.current),
    bindings: tuiConfig.keybinds.gather("subagent.nav", NAV),
  }))

  useBindings(() => ({
    mode: KILO_BASE_MODE,
    priority: 1,
    enabled: () => KiloSteer.idle(prompt.current),
    bindings: tuiConfig.keybinds.get("app.exit").map((binding) => ({
      ...binding,
      cmd: () => {
        if (quit.press()) exit()
      },
    })),
  }))

  return {
    interruptible,
    paused,
    interrupt: interrupt.count,
    exit: quit.count,
  }
}
