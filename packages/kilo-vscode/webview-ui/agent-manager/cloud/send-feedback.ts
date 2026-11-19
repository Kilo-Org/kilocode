import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { SessionMessage } from "@opencode/schema/session-message"
import { createSignal } from "solid-js"

type User = Extract<KiloHostedRpc.Message, { type: "user" }>

/** Per hosted chat, separate from durable pages. An RPC receipt and the live stream can arrive in either order. */
export function createSendFeedback() {
  const [rows, setRows] = createSignal<readonly User[]>([])
  const [sending, setSending] = createSignal<string>()
  let attempt: { key: string; id: string; text: string; echo: PromiseWithResolvers<void> } | undefined

  function begin(key: string, text: string, files: User["files"]) {
    const id = attempt?.key === key ? attempt.id : SessionMessage.ID.create()
    attempt = { key, id, text, echo: Promise.withResolvers<void>() }
    setRows((prev) => [
      ...prev.filter((r) => r.id !== id).slice(-31),
      { id, type: "user", text, time: { created: Date.now() }, ...(files?.length && { files }) },
    ])
    setSending(id)
    return attempt
  }
  function accept(id: string) {
    if (attempt?.id !== id) return
    const { text, echo } = attempt
    attempt = undefined
    setSending(undefined)
    echo.resolve()
    return text
  }
  function remove(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }
  function rollback() {
    const id = sending()
    if (!id) return
    remove(id)
    setSending(undefined)
    // Keep only the retry identity. Never replay an ambiguous send on reconnect.
  }
  return {
    rows,
    sending,
    begin,
    accept,
    rollback,
    remove,
    observe(messages: readonly KiloHostedRpc.Message[], queued: readonly string[] = []) {
      if (!rows().length && !attempt) return
      const ids = new Set(messages.map((m) => m.id))
      if (rows().some((r) => ids.has(r.id))) setRows((prev) => prev.filter((r) => !ids.has(r.id)))
      if (attempt && (ids.has(attempt.id) || queued.includes(attempt.id))) return accept(attempt.id)
    },
    clear() {
      attempt = undefined
      setSending(undefined)
      setRows([])
    },
  }
}
