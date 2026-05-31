import { describe, expect, it, mock } from "bun:test"
import { createRoot } from "solid-js"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

mock.module("@kilocode/kilo-ui/toast", () => ({
  showToast: () => undefined,
}))

const { useSpeechToText } = await import("../../webview-ui/src/components/speech-to-text/useSpeechToText")

function setup() {
  const sent: WebviewMessage[] = []
  let handler: ((message: ExtensionMessage) => void) | undefined

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
      { profileData: () => ({}), goToLogin: () => {} },
      { t: (key) => key },
    ),
  }))

  const fire = (message: ExtensionMessage) => handler?.(message)
  return { ...root, fire, sent }
}

describe("useSpeechToText", () => {
  it("runs the stop completion after inserting a transcript", () => {
    const ctx = setup()
    const text: string[] = []
    let done = 0

    ctx.speech.start({ model: "scribe", insert: (value) => text.push(value) })
    const start = ctx.sent[0]
    if (start?.type !== "speechToTextStart") throw new Error("speech start message missing")

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

    ctx.speech.stop({ done: () => done++, ready: () => false })
    ctx.fire({ type: "speechToTextResult", requestId: start.requestId, text: "Keep as draft" })

    expect(text).toEqual(["Keep as draft"])
    expect(done).toBe(0)
    expect(ctx.speech.state()).toBe("idle")
    ctx.dispose()
  })
})
