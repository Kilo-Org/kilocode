import { createMemo } from "solid-js"
import { useTuiConfig } from "../config"
import { useExit } from "../context/exit"
import { useRouteData } from "../context/route"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { KILO_BASE_MODE, useBindings } from "../keymap"
import { useToast } from "../ui/toast"
import { running } from "../util/session"
import { createDoublePress } from "./double-press"

/**
 * Subagent-view keys: double Esc stops this subagent, and the configured exit keys need a second
 * press. Call it from a component that is mounted only for subagent sessions (the subagent footer).
 */
export function useSubagentKeys() {
  const route = useRouteData("session")
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

  // Same stop as the VS Code task card: this subagent and anything it started. The parent
  // keeps running and receives the cancelled task result.
  function stop() {
    if (!interrupt.press()) return
    const fail = () => toast.show({ message: "Failed to interrupt subagent", variant: "error" })
    void sdk.client.session.abort({ sessionID: route.sessionID, scope: "tree" }).then((res) => {
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

  useBindings(() => ({
    mode: KILO_BASE_MODE,
    priority: 1,
    bindings: tuiConfig.keybinds.get("app.exit").map((binding) => ({
      ...binding,
      cmd: () => {
        if (quit.press()) exit()
      },
    })),
  }))

  return {
    interruptible,
    interrupt: interrupt.count,
    exit: quit.count,
  }
}
