// The speech status is resolved by the host from the machine-wide config and the Gateway account, then pushed back.
// The host is the only side that reads the config file, so a websocket-style draft in the Settings panel and an
// already-open composer agree after the next request.
import { createContext, createEffect, createSignal, onCleanup, onMount, useContext, type ParentComponent } from "solid-js"
import type { SpeechSettingKey, SpeechToTextStatus } from "../../../../src/protocol"
import { useVSCode } from "../../context/vscode"
import { useV2 } from "../../v2/client"
import { emptySpeechStatus } from "./availability"

const EVENTS = new Set(["config.updated", "integration.updated", "model.updated", "provider.updated"])

// The last status the host sent. The Agent Manager mounts this provider per worktree, so the composer that replaces
// the previous worktree starts with the known status instead of dropping the mic until the next reply.
let lastStatus: SpeechToTextStatus | undefined

type SpeechStatusValue = {
  status: () => SpeechToTextStatus
  /** Re-reads the config and the Gateway account; coalesces bursts from one settings write. */
  request: () => void
  /** Writes one experimental speech key to the global config the host reads. */
  save: (key: SpeechSettingKey, value: string) => Promise<void>
}

const Context = createContext<SpeechStatusValue>()

export const SpeechToTextStatusProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const v2 = useV2()
  const [status, setStatus] = createSignal<SpeechToTextStatus>(lastStatus ?? emptySpeechStatus())
  const saves = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let prepared = false
  let catalogRetried = false

  const request = () => {
    clearTimeout(timer)
    timer = setTimeout(() => vscode.postMessage({ type: "speechToTextConfig" }), 50)
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "speechToTextSaved") {
      const pending = saves.get(message.requestId)
      if (!pending) return
      saves.delete(message.requestId)
      if (message.ok) pending.resolve()
      else pending.reject(new Error(message.error ?? "Could not save the speech settings"))
      return
    }
    if (message.type !== "speechToTextConfigLoaded") return
    lastStatus = message.status
    setStatus(message.status)
    if (message.status.enabled && !prepared) {
      prepared = true
      vscode.postMessage({ type: "speechToTextPrewarm" })
    }
  })
  // Re-resolve after a config write or a sign-in, so the mic appears or disappears without reopening the sidebar.
  const stopListening = v2.data.listen((event) => {
    if (EVENTS.has(event.name)) request()
  })
  const save = (key: SpeechSettingKey, value: string) =>
    new Promise<void>((resolve, reject) => {
      const requestId = crypto.randomUUID()
      saves.set(requestId, { resolve, reject })
      vscode.postMessage({ type: "speechToTextSave", requestId, key, value })
    })
  const focus = () => request()
  createEffect(() => {
    if (vscode.active()) request()
  })
  // Retry a failed Gateway catalog, as the v1 catalog provider did, instead of keeping the static fallback.
  createEffect(() => {
    if (!status().catalogError) {
      catalogRetried = false
      return
    }
    if (catalogRetried) return
    catalogRetried = true
    const retry = setTimeout(request, 3000)
    onCleanup(() => clearTimeout(retry))
  })
  onMount(() => {
    request()
    window.addEventListener("focus", focus)
  })
  onCleanup(() => {
    clearTimeout(timer)
    unsubscribe()
    stopListening()
    window.removeEventListener("focus", focus)
    saves.clear()
  })

  return <Context.Provider value={{ status, request, save }}>{props.children}</Context.Provider>
}

export function useSpeechStatus(): SpeechStatusValue {
  const value = useContext(Context)
  if (!value) throw new Error("useSpeechStatus must be used inside SpeechToTextStatusProvider")
  return value
}
