import { describe, expect, it, mock } from "bun:test"
import { createRoot } from "solid-js"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"
import {
  createSpeechShortcut,
  isSpeechShortcut,
  SPEECH_HOLD_MS,
  speechShortcutLabel,
  speechShortcutValue,
  toggleSpeech,
} from "../../webview-ui/src/components/speech-to-text/shortcut"

type Toast = {
  actions?: Array<{ onClick: string | (() => void) }>
}

const toasts: Toast[] = []
mock.module("@kilocode/kilo-ui/toast", () => ({
  showToast: (toast: Toast) => toasts.push(toast),
}))

const { useSpeechToText } = await import("../../webview-ui/src/components/speech-to-text/useSpeechToText")

function setup() {
  const sent: WebviewMessage[] = []
  let handler: ((message: ExtensionMessage) => void) | undefined
  let logins = 0
  toasts.length = 0

  const root = createRoot((dispose) => ({
    dispose,
    speech: useSpeechToText(
      {
        postMessage: (message) => sent.push(message),
        onMessage: (next) => {
          handler = next
          return () => {
            handler = undefined
          }
        },
      },
      { goToLogin: () => logins++ },
      { t: (key) => key },
    ),
  }))

  const fire = (message: ExtensionMessage) => handler?.(message)
  return { ...root, fire, sent, logins: () => logins }
}

describe("useSpeechToText", () => {
  it("waits for microphone readiness before reporting recording", () => {
    const ctx = setup()

    ctx.speech.start({ model: "scribe", insert: () => {} })
    const start = ctx.sent[0]
    if (start?.type !== "speechToTextStart") throw new Error("speech start message missing")

    expect(ctx.speech.state()).toBe("starting")
    expect(ctx.speech.active()).toBe(true)

    ctx.fire({ type: "speechToTextStarted", requestId: "another-request" })
    expect(ctx.speech.state()).toBe("starting")

    ctx.fire({ type: "speechToTextStarted", requestId: start.requestId })
    expect(ctx.speech.state()).toBe("recording")
    ctx.dispose()
  })

  it("does not stop or start another recording while the microphone is starting", () => {
    const ctx = setup()

    ctx.speech.start({ model: "scribe", insert: () => {} })
    const start = ctx.sent[0]
    if (start?.type !== "speechToTextStart") throw new Error("speech start message missing")

    ctx.speech.stop()
    ctx.speech.start({ model: "other", insert: () => {} })
    expect(ctx.speech.state()).toBe("starting")
    expect(ctx.sent).toEqual([start])

    ctx.fire({ type: "speechToTextStarted", requestId: start.requestId })
    ctx.speech.stop()
    expect(ctx.speech.state()).toBe("transcribing")
    expect(ctx.sent[1]).toEqual({ type: "speechToTextStop", requestId: start.requestId })
    ctx.dispose()
  })

  it("cancels a pending microphone startup and ignores its late acknowledgement", () => {
    const ctx = setup()

    ctx.speech.start({ model: "scribe", insert: () => {} })
    const start = ctx.sent[0]
    if (start?.type !== "speechToTextStart") throw new Error("speech start message missing")

    ctx.speech.cancel()
    expect(ctx.sent[1]).toEqual({ type: "speechToTextCancel", requestId: start.requestId })
    expect(ctx.speech.state()).toBe("idle")

    ctx.fire({ type: "speechToTextStarted", requestId: start.requestId })
    expect(ctx.speech.state()).toBe("idle")
    ctx.dispose()
  })

  it("offers sign-in when stored credentials stop authenticating", () => {
    const ctx = setup()

    ctx.speech.start({ model: "scribe", insert: () => {} })
    const start = ctx.sent[0]
    if (start?.type !== "speechToTextStart") throw new Error("speech start message missing")

    ctx.fire({
      type: "speechToTextError",
      requestId: start.requestId,
      error: "Unauthorized",
      code: "not_authenticated",
    })
    const action = toasts[0]?.actions?.find((item) => typeof item.onClick === "function")
    if (typeof action?.onClick === "function") action.onClick()

    expect(ctx.logins()).toBe(1)
    expect(ctx.speech.error()).toBe("speechToText.error.loginRequired")
    ctx.dispose()
  })

  it("runs the stop completion after inserting a transcript", () => {
    const ctx = setup()
    const text: string[] = []
    let done = 0

    ctx.speech.start({ model: "scribe", insert: (value) => text.push(value) })
    const start = ctx.sent[0]
    if (start?.type !== "speechToTextStart") throw new Error("speech start message missing")
    ctx.fire({ type: "speechToTextStarted", requestId: start.requestId })

    ctx.speech.stop({ done: () => done++ })
    ctx.fire({ type: "speechToTextResult", requestId: start.requestId, text: "Recorded prompt" })

    expect(text).toEqual(["Recorded prompt"])
    expect(done).toBe(1)
    expect(ctx.speech.state()).toBe("idle")
    ctx.dispose()
  })

  it("drops the stop completion when transcription is cancelled", () => {
    const ctx = setup()
    let done = 0

    ctx.speech.start({ model: "scribe", insert: () => {} })
    const start = ctx.sent[0]
    if (start?.type !== "speechToTextStart") throw new Error("speech start message missing")
    ctx.fire({ type: "speechToTextStarted", requestId: start.requestId })

    ctx.speech.stop({ done: () => done++ })
    ctx.speech.cancel()
    ctx.fire({ type: "speechToTextResult", requestId: start.requestId, text: "Ignored prompt" })

    expect(done).toBe(0)
    expect(ctx.speech.state()).toBe("idle")
    ctx.dispose()
  })

  it("drops the stop completion when the send context changes", () => {
    const ctx = setup()
    const text: string[] = []
    let done = 0

    ctx.speech.start({ model: "scribe", insert: (value) => text.push(value) })
    const start = ctx.sent[0]
    if (start?.type !== "speechToTextStart") throw new Error("speech start message missing")
    ctx.fire({ type: "speechToTextStarted", requestId: start.requestId })

    ctx.speech.stop({ done: () => done++, ready: () => false })
    ctx.fire({ type: "speechToTextResult", requestId: start.requestId, text: "Keep as draft" })

    expect(text).toEqual(["Keep as draft"])
    expect(done).toBe(0)
    expect(ctx.speech.state()).toBe("idle")
    ctx.dispose()
  })
})

describe("speech shortcut", () => {
  const key = (timeStamp: number, repeat = false) => ({
    key: "k",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat,
    timeStamp,
  })

  it("accepts only the platform modifier with K", () => {
    expect(isSpeechShortcut({ key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, true)).toBe(
      true,
    )
    expect(isSpeechShortcut({ key: "k", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }, true)).toBe(
      false,
    )
    expect(isSpeechShortcut({ key: "k", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }, false)).toBe(
      true,
    )
    expect(isSpeechShortcut({ key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, false)).toBe(
      false,
    )
    expect(isSpeechShortcut({ key: "k", metaKey: true, ctrlKey: false, altKey: true, shiftKey: false }, true)).toBe(
      false,
    )
    expect(isSpeechShortcut({ key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }, true)).toBe(
      false,
    )
  })

  it("exposes platform-specific labels for the focused input", () => {
    expect(speechShortcutLabel(true)).toBe("⌘K")
    expect(speechShortcutValue(true)).toBe("Meta+K")
    expect(speechShortcutLabel(false)).toBe("Ctrl+K")
    expect(speechShortcutValue(false)).toBe("Control+K")
  })

  it("does not handle a shortcut when speech is unavailable", () => {
    const ctx = setup()
    let started = 0
    expect(toggleSpeech(ctx.speech, true, () => started++)).toBe(false)
    expect(started).toBe(0)
    ctx.dispose()
  })

  it("ignores key repeat and keeps a quick press recording", () => {
    const ctx = setup()
    const shortcut = createSpeechShortcut({
      speech: ctx.speech,
      disabled: () => false,
      start: () => ctx.speech.start({ model: "scribe", insert: () => {} }),
      finish: () => ctx.speech.stop(),
      mac: true,
    })

    expect(shortcut.down(key(0))).toBe(true)
    expect(shortcut.down(key(50, true))).toBe(true)
    expect(shortcut.down(key(100, true))).toBe(true)
    expect(shortcut.up(key(SPEECH_HOLD_MS - 1))).toBe(true)
    expect(ctx.sent).toHaveLength(1)
    expect(ctx.speech.state()).toBe("starting")

    const start = ctx.sent[0]
    if (start?.type !== "speechToTextStart") throw new Error("speech start message missing")
    ctx.fire({ type: "speechToTextStarted", requestId: start.requestId })
    expect(ctx.speech.state()).toBe("recording")
    ctx.dispose()
  })

  it("stops recording on a second quick press", () => {
    const ctx = setup()
    const shortcut = createSpeechShortcut({
      speech: ctx.speech,
      disabled: () => false,
      start: () => ctx.speech.start({ model: "scribe", insert: () => {} }),
      finish: () => ctx.speech.stop(),
      mac: true,
    })

    shortcut.down(key(0))
    shortcut.up(key(100))
    const start = ctx.sent[0]
    if (start?.type !== "speechToTextStart") throw new Error("speech start message missing")
    ctx.fire({ type: "speechToTextStarted", requestId: start.requestId })

    shortcut.down(key(200))
    shortcut.down(key(250, true))
    shortcut.up(key(300))
    expect(ctx.speech.state()).toBe("transcribing")
    expect(ctx.sent[1]).toEqual({ type: "speechToTextStop", requestId: start.requestId })
    ctx.dispose()
  })

  it("queues transcription and submit when a held press is released during startup", () => {
    const ctx = setup()
    let submitted = 0
    const shortcut = createSpeechShortcut({
      speech: ctx.speech,
      disabled: () => false,
      start: () => ctx.speech.start({ model: "scribe", insert: () => {} }),
      finish: (submit) => ctx.speech.stop(submit ? { done: () => submitted++ } : undefined),
      mac: true,
    })

    shortcut.down(key(0))
    shortcut.up(key(SPEECH_HOLD_MS))
    expect(ctx.speech.state()).toBe("starting")
    expect(ctx.sent).toHaveLength(1)

    const start = ctx.sent[0]
    if (start?.type !== "speechToTextStart") throw new Error("speech start message missing")
    ctx.fire({ type: "speechToTextStarted", requestId: start.requestId })
    expect(ctx.speech.state()).toBe("transcribing")
    expect(ctx.sent[1]).toEqual({ type: "speechToTextStop", requestId: start.requestId })

    ctx.fire({ type: "speechToTextResult", requestId: start.requestId, text: "Held prompt" })
    expect(submitted).toBe(1)
    ctx.dispose()
  })

  it("submits when macOS suppresses K key-up and only reports Command release", () => {
    const ctx = setup()
    let submitted = 0
    const shortcut = createSpeechShortcut({
      speech: ctx.speech,
      disabled: () => false,
      start: () => ctx.speech.start({ model: "scribe", insert: () => {} }),
      finish: (submit) => ctx.speech.stop(submit ? { done: () => submitted++ } : undefined),
      mac: true,
    })

    shortcut.down(key(0))
    const start = ctx.sent[0]
    if (start?.type !== "speechToTextStart") throw new Error("speech start message missing")
    ctx.fire({ type: "speechToTextStarted", requestId: start.requestId })

    expect(shortcut.up({ key: "Meta", timeStamp: SPEECH_HOLD_MS })).toBe(true)
    expect(ctx.speech.state()).toBe("transcribing")
    expect(ctx.sent[1]).toEqual({ type: "speechToTextStop", requestId: start.requestId })

    ctx.fire({ type: "speechToTextResult", requestId: start.requestId, text: "Held prompt" })
    expect(submitted).toBe(1)
    ctx.dispose()
  })
})
