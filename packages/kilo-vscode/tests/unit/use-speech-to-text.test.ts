import { describe, expect, it, mock } from "bun:test"
import { createRoot } from "solid-js"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

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
