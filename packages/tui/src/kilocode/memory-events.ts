import { KiloMemoryRpc } from "@opencode/schema/kilocode/memory"

type Event = {
  on(type: "error", fn: (event: { data: KiloMemoryRpc.Event }) => void): () => void
}

type Toast = {
  show(input: { message: string; variant: "error" | "info" | "success"; duration: number }): void
}

export namespace MemoryTuiEvents {
  /** Toasts memory errors of the open session; `sessionID` returns undefined outside a session view. */
  export function attach(input: { event: Event; toast: Toast; sessionID: () => string | undefined }) {
    return input.event.on("error", (event) => {
      const current = input.sessionID()
      if (!current) return
      if (event.data.sessionID && event.data.sessionID !== current) return
      if (event.data.reason === KiloMemoryRpc.TRANSIENT) return
      const detail = event.data.detail
      if (!detail) {
        input.toast.show({
          message: `Memory error${event.data.reason ? ` · ${event.data.reason}` : ""}`,
          variant: "error",
          duration: 3500,
        })
        return
      }
      input.toast.show({ message: detail.message, variant: "error", duration: 3500 })
    })
  }
}
