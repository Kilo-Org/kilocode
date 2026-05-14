import { createSignal, onCleanup } from "solid-js"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { Accessor } from "solid-js"
import type { ExtensionMessage, WebviewMessage } from "../../types/messages"

type VSCode = {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

type Server = {
  profileData: Accessor<unknown | null>
  goToLogin: () => void
}

type Lang = {
  t: (key: string) => string
}

export type SpeechState = "idle" | "recording" | "transcribing" | "error"

export type InsertTranscript = (text: string) => void

type StartOptions = {
  model: string
  insert: InsertTranscript
}

export type SpeechToText = {
  state: Accessor<SpeechState>
  error: Accessor<string | undefined>
  active: Accessor<boolean>
  start: (opts: StartOptions) => void
  stop: () => void
  cancel: () => void
  clear: () => void
}

export function useSpeechToText(vscode: VSCode, server: Server, lang: Lang): SpeechToText {
  const [state, setState] = createSignal<SpeechState>("idle")
  const [error, setError] = createSignal<string | undefined>()
  const active = () => state() === "recording" || state() === "transcribing"
  const prefix = globalThis.crypto?.randomUUID?.() ?? `stt-${Math.random().toString(36).slice(2)}`

  let request = ""
  let counter = 0
  let insert: InsertTranscript | undefined

  const unsub = vscode.onMessage((msg) => {
    if (!isSpeechMessage(msg)) return
    if (msg.requestId !== request) return

    if (msg.type === "speechToTextStarted") {
      setState("recording")
      return
    }

    if (msg.type === "speechToTextCancelled") {
      cleanup()
      setState("idle")
      setError(undefined)
      return
    }

    if (msg.type === "speechToTextError") {
      fail(msg.error)
      return
    }

    const text = msg.text.trim()
    if (!text) {
      fail(lang.t("speechToText.error.emptyTranscript"))
      return
    }

    insert?.(text)
    cleanup()
    setState("idle")
    setError(undefined)
  })

  onCleanup(() => {
    unsub()
    cancel()
  })

  function start(opts: StartOptions) {
    if (active()) return
    insert = opts.insert
    setError(undefined)

    if (!server.profileData()) {
      showToast({
        variant: "error",
        title: lang.t("speechToText.error.loginRequired"),
        actions: [
          { label: lang.t("common.signIn"), onClick: server.goToLogin },
          { label: lang.t("common.dismiss"), onClick: "dismiss" },
        ],
      })
      fail(lang.t("speechToText.error.loginRequired"), false)
      return
    }

    counter++
    request = `${prefix}-${counter}`
    setState("recording")
    vscode.postMessage({
      type: "speechToTextStart",
      requestId: request,
      model: opts.model,
      language: langCode(),
    })
  }

  function stop() {
    if (state() !== "recording") return
    setState("transcribing")
    vscode.postMessage({ type: "speechToTextStop", requestId: request })
  }

  function cancel() {
    if (request && active()) vscode.postMessage({ type: "speechToTextCancel", requestId: request })
    cleanup()
    setState("idle")
    setError(undefined)
  }

  function clear() {
    if (state() !== "error") return
    cleanup()
    setState("idle")
    setError(undefined)
  }

  function fail(message: string, toast = true) {
    cleanup()
    setState("error")
    setError(message)
    if (toast) showToast({ variant: "error", title: lang.t("speechToText.error.title"), description: message })
  }

  function cleanup() {
    request = ""
    insert = undefined
  }

  return { state, error, active, start, stop, cancel, clear }
}

function isSpeechMessage(
  msg: ExtensionMessage,
): msg is Extract<
  ExtensionMessage,
  { type: "speechToTextStarted" | "speechToTextCancelled" | "speechToTextResult" | "speechToTextError" }
> {
  return (
    msg.type === "speechToTextStarted" ||
    msg.type === "speechToTextCancelled" ||
    msg.type === "speechToTextResult" ||
    msg.type === "speechToTextError"
  )
}

function langCode() {
  return (navigator.language || "en").split("-")[0] || "en"
}
