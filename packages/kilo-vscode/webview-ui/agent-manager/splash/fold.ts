import { createSignal } from "solid-js"
import type { VsCodePoster } from "../sidebar-collapse"

/**
 * Persisted splash preferences. `folded` stays unset until Show examples or
 * the first accepted session chooses a fold. `dismissed` is the legacy intro
 * key: an explicit Hide (or a Skip from the legacy intro) hides the splash
 * behind the intro's reopen button, ahead of any fold.
 */
export function createFold(vscode: VsCodePoster, initial?: boolean, dismissed = false) {
  const [folded, setFolded] = createSignal(initial)
  const [hidden, setHidden] = createSignal(dismissed)
  const save = (value: boolean) => {
    setFolded(value)
    vscode.postMessage({ type: "agentManager.setSplashFolded", folded: value })
  }
  const dismiss = (value: boolean) => {
    setHidden(value)
    vscode.postMessage({ type: "agentManager.setIntroDismissed", dismissed: value })
  }
  return {
    folded: () => folded() === true,
    hidden,
    hide: () => dismiss(true),
    show: () => {
      save(false)
      if (hidden()) dismiss(false)
    },
    started: () => {
      if (hidden()) return
      if (folded() === undefined) save(true)
    },
  }
}
