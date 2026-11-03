import { createSignal } from "solid-js"
import type { VsCodePoster } from "../sidebar-collapse"

/**
 * Persisted fold preference for the splash. It stays unset until Hide, Show
 * examples or the first accepted session chooses one, so only that first
 * session folds the splash automatically.
 */
export function createFold(vscode: VsCodePoster, initial?: boolean) {
  const [folded, setFolded] = createSignal(initial)
  const save = (value: boolean) => {
    setFolded(value)
    vscode.postMessage({ type: "agentManager.setSplashFolded", folded: value })
  }
  return {
    folded: () => folded() === true,
    fold: () => save(true),
    unfold: () => save(false),
    started: () => {
      if (folded() === undefined) save(true)
    },
  }
}
