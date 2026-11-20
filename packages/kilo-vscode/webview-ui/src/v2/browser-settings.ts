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
import { requestTracker } from "./browser-settings-requests"

export function createBrowserSettings() {
  const vscode = useVSCode()
  const [state, setState] = createSignal<BrowserSettingsState>()
  const [status, setStatus] = createSignal<BrowserSettingsStatus>()
  const [error, setError] = createSignal<string>()
  const [progress, setProgress] = createSignal<string>()
  const [reading, setReading] = createSignal(false)
  const [writing, setWriting] = createSignal(false)
  const [installing, setInstalling] = createSignal(false)
  const tracker = requestTracker()

  const send = (request: { type: string; requestId: string; patch?: BrowserSettingsPatch }) => {
    getVSCodeAPI().postMessage(request as never)
  }

  const unsubscribe = vscode.onMessage((raw) => {
    const message = raw as unknown as ToWebview
    if (message.type === "browserSettingsLoaded") {
      if (!tracker.accepts(message.requestId)) return
      const operation = tracker.kindOf(message.requestId)
      // A status refresh only replaces the status: it never ends another attempt or clears an error it did not cause.
      if (operation === "status") {
        if (message.status) setStatus(message.status)
        return
      }
      // Every other attempt ends on its own reply, whichever operation it was: a read or a write answers with the
      // state, and an install the host could not start answers with this message instead of `browserSettingsInstalled`.
      if (operation === "install") {
        setInstalling(false)
        setProgress(undefined)
      } else if (operation === "write") setWriting(false)
      else setReading(false)
      setError(message.error)
      if (message.state) setState(message.state)
      if (message.status) setStatus(message.status)
      return
    }
    if (message.type === "browserSettingsInstallProgress") {
      if (!tracker.accepts(message.requestId)) return
      setProgress(message.text.trim())
      return
    }
    if (message.type === "browserSettingsInstalled") {
      if (!tracker.accepts(message.requestId)) return
      setInstalling(false)
      setProgress(undefined)
      setStatus(message.status)
      setError(message.ok ? undefined : (message.error ?? ""))
    }
  })
  onCleanup(unsubscribe)

  return {
    state,
    status,
    error,
    progress,
    /** A read or a write is in flight; the panel disables the controls meanwhile. */
    busy: () => reading() || writing(),
    installing,
    load: () => {
      setReading(true)
      setError(undefined)
      send({ type: "browserSettingsRead", requestId: tracker.start("read") })
    },
    write: (patch: BrowserSettingsPatch) => {
      setWriting(true)
      setError(undefined)
      send({ type: "browserSettingsWrite", requestId: tracker.start("write"), patch })
    },
    install: () => {
      setInstalling(true)
      setProgress(undefined)
      setError(undefined)
      send({ type: "browserSettingsInstall", requestId: tracker.start("install") })
    },
    /** Read the machine status again, for the live status rows. */
    refresh: () => send({ type: "browserSettingsStatus", requestId: tracker.start("status") }),
  }
}
