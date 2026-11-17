// The Browser section's data: the state the host read from the Kilo config and whether the tools can run. Every write
// answers with the whole state, so the panel never applies a patch locally and never drifts from the file.
import { createSignal, onCleanup } from "solid-js"
import type {
  BrowserSettingsPatch,
  BrowserSettingsState,
  BrowserSettingsStatus,
  ToWebview,
} from "../../../src/protocol"
import { getVSCodeAPI, useVSCode } from "../context/vscode"

type Request =
  | { type: "browserSettingsRead"; requestId: string }
  | { type: "browserSettingsWrite"; requestId: string; patch: BrowserSettingsPatch }
  | { type: "browserSettingsInstall"; requestId: string }

export function createBrowserSettings() {
  const vscode = useVSCode()
  const [state, setState] = createSignal<BrowserSettingsState>()
  const [status, setStatus] = createSignal<BrowserSettingsStatus>()
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [installing, setInstalling] = createSignal(false)
  // A later request supersedes an earlier one, so a slow reply to the previous edit cannot overwrite the new state.
  let latest = 0

  const send = (build: (requestId: string) => Request) => {
    const requestId = String(++latest)
    getVSCodeAPI().postMessage(build(requestId) as never)
  }

  const unsubscribe = vscode.onMessage((raw) => {
    const message = raw as unknown as ToWebview
    if (message.type === "browserSettingsLoaded") {
      if (message.requestId !== String(latest)) return
      setBusy(false)
      setError(message.error)
      if (message.state) setState(message.state)
      if (message.status) setStatus(message.status)
      return
    }
    if (message.type === "browserSettingsInstalled") {
      if (message.requestId !== String(latest)) return
      setInstalling(false)
      setStatus(message.status)
      setError(message.ok ? undefined : (message.error ?? ""))
    }
  })
  onCleanup(unsubscribe)

  const write = (patch: BrowserSettingsPatch) => {
    setBusy(true)
    setError(undefined)
    send((requestId) => ({ type: "browserSettingsWrite", requestId, patch }))
  }

  return {
    state,
    status,
    error,
    busy,
    installing,
    load: () => {
      setBusy(true)
      send((requestId) => ({ type: "browserSettingsRead", requestId }))
    },
    write,
    install: () => {
      setInstalling(true)
      setError(undefined)
      send((requestId) => ({ type: "browserSettingsInstall", requestId }))
    },
  }
}
