import { createSignal, onCleanup, onMount, type Component } from "solid-js"
import { useVSCode } from "../src/context/vscode"
import type { CaffeinationState } from "../src/types/messages"
import { CaffeinationButton } from "./CaffeinationButton"

export const Caffeination: Component<{ t: (key: string) => string }> = (props) => {
  const vscode = useVSCode()
  const [state, setState] = createSignal<CaffeinationState>({ enabled: false, active: false, available: false })
  onCleanup(
    vscode.onMessage((message) => {
      if (message.type === "agentManager.caffeination") setState(message)
    }),
  )
  onMount(() => vscode.postMessage({ type: "agentManager.requestCaffeination" }))
  const toggle = () => {
    const current = state()
    vscode.postMessage({ type: "agentManager.setCaffeination", enabled: !(current.enabled || current.active) })
  }
  return <CaffeinationButton t={props.t} state={state} onToggle={toggle} />
}
