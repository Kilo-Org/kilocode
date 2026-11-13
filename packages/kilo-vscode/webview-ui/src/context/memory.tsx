// Project memory of the v2 webviews, ported from v1's context/memory.tsx. Status and operations go through the
// extension host (src/kilo-provider/memory.ts) over the `kilocode.memory` RPC; memory events come from the RPC
// directly, and a background capture failure (`TRANSIENT`) is not toasted.
import { createContext, createEffect, createMemo, createSignal, on, onCleanup, useContext } from "solid-js"
import type { Accessor, ParentComponent } from "solid-js"
import { showToast } from "@kilocode/kilo-ui/toast"
import { KiloMemoryRpc } from "@opencode/schema/kilocode/memory"
import type { MemoryOperationMessage, ToHost, ToWebview } from "../../../src/protocol"
import { getVSCodeAPI, useVSCode } from "./vscode"
import { useLanguage } from "./language"
import { useV2Optional } from "../v2/client"
import { memoryEventToast, memoryResultToast, type MemoryEventName } from "./memory-utils"

type Status = KiloMemoryRpc.Status
type Operation = Omit<MemoryOperationMessage, "type">

export interface MemoryContextValue {
  status: Accessor<Status | undefined>
  loading: Accessor<boolean>
  pending: Accessor<boolean>
  error: Accessor<string | undefined>
  enabled: Accessor<boolean>
  totalTokens: Accessor<number>
  refresh: () => void
  inspect: () => void
  enable: () => void
  disable: () => void
  auto: (mode: "on" | "off") => void
  /** Runs an operation typed in the composer, for example `/memory remember`. */
  run: (operation: Operation) => void
  /** Opens the Quick Pick overview of the stored memory or its status. */
  show: (mode: "show" | "status", sessionID?: string) => void
}

export const MemoryContext = createContext<MemoryContextValue>()

export const MemoryProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const v2 = useV2Optional()
  const language = useLanguage()
  const [status, setStatus] = createSignal<Status | undefined>()
  const [loading, setLoading] = createSignal(false)
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>()
  const post = (message: ToHost) => getVSCodeAPI().postMessage(message as never)
  const connected = () => v2?.connection.status() === "connected"
  const state = { last: undefined as { key: string; time: number } | undefined }

  const refresh = () => {
    if (!connected()) return
    setLoading(true)
    setError(undefined)
    post({ type: "requestMemory" })
  }

  const run = (operation: Operation) => {
    if (!connected()) return
    setPending(true)
    setError(undefined)
    post({ type: "memoryOperation", ...operation })
  }

  const loaded = (message: Extract<ToWebview, { type: "memoryLoaded" }>) => {
    setLoading(false)
    if (message.error) {
      setError(message.error)
      setStatus(undefined)
      return
    }
    if (message.status) setStatus(message.status)
    setError(undefined)
  }

  const done = (message: Extract<ToWebview, { type: "memoryOperationResult" }>) => {
    setPending(false)
    setLoading(false)
    if (!message.ok) {
      const err = message.error ?? language.t("chat.memory.command.failed")
      setError(err)
      showToast({ variant: "error", title: err })
      return
    }
    if (message.status) setStatus(message.status)
    setError(undefined)
    const toast = memoryResultToast(message.operation)
    if (toast) showToast({ variant: "success", title: language.t(toast) })
  }

  const unsubscribe = vscode.onMessage((raw) => {
    const message = raw as unknown as ToWebview
    if (message.type === "memoryLoaded") return loaded(message)
    if (message.type === "memoryOperationResult") return done(message)
  })
  onCleanup(unsubscribe)

  createEffect(
    on(
      () => v2?.connection.status(),
      (connection) => {
        if (connection !== "connected" || !v2) {
          setLoading(false)
          return
        }
        refresh()
        const rpc = v2.api.rpc(KiloMemoryRpc.Definition)
        const receive = (name: MemoryEventName) =>
          rpc.events.on(name, (event) => {
            const location = event.location?.directory
            if (location && location !== v2.directory) return
            const toast = memoryEventToast(name, event.data, state.last, Date.now())
            if (toast) {
              state.last = { key: toast.key, time: Date.now() }
              showToast({ variant: "error", title: toast.message })
            }
            refresh()
          })
        const stops = [receive("status"), receive("updated"), receive("error")]
        onCleanup(() => stops.forEach((stop) => stop()))
      },
    ),
  )

  const value: MemoryContextValue = {
    status,
    loading,
    pending,
    error,
    enabled: createMemo(() => status()?.state.enabled ?? false),
    totalTokens: createMemo(() => status()?.index.estimatedTokens ?? 0),
    refresh,
    inspect: () => run({ operation: "inspect" }),
    enable: () => run({ operation: "enable" }),
    disable: () => run({ operation: "disable" }),
    auto: (mode) => run({ operation: "auto", mode }),
    run,
    show: (mode, sessionID) => {
      if (!connected()) return
      post({ type: "memoryShow", mode, sessionID })
    },
  }

  return <MemoryContext.Provider value={value}>{props.children}</MemoryContext.Provider>
}

export function useMemory(): MemoryContextValue | undefined {
  return useContext(MemoryContext)
}
