import { afterEach, describe, expect, it } from "bun:test"
import { playWebviewSound, registerSoundWebview } from "../../src/services/attention/webview-sound"

const disposables: Array<{ dispose: () => void }> = []

afterEach(() => {
  for (const disposable of disposables.splice(0)) disposable.dispose()
})

function target(name: string, delivered = true) {
  const messages: unknown[] = []
  const registration = registerSoundWebview(
    (message) => {
      messages.push(message)
      return Promise.resolve(delivered)
    },
    (id) => `sound://${name}/${id}.wav`,
  )
  disposables.push(registration)
  return { messages, registration }
}

describe("webview notification sounds", () => {
  it("delivers a sound to only the most recent ready webview", async () => {
    const previous = target("previous")
    const recent = target("recent")
    previous.registration.ready()
    recent.registration.ready()

    expect(await playWebviewSound("bip-bop-01")).toBe(true)
    expect(previous.messages).toEqual([])
    expect(recent.messages).toEqual([{ type: "playNotificationSound", uri: "sound://recent/bip-bop-01.wav" }])
  })

  it("skips webviews that are not ready", async () => {
    const pending = target("pending")
    const ready = target("ready")
    ready.registration.ready()

    expect(await playWebviewSound("nope-03")).toBe(true)
    expect(pending.messages).toEqual([])
    expect(ready.messages).toEqual([{ type: "playNotificationSound", uri: "sound://ready/nope-03.wav" }])
  })

  it("falls back when the preferred webview cannot receive the message", async () => {
    const fallback = target("fallback")
    const failed = target("failed", false)
    fallback.registration.ready()
    failed.registration.ready()

    expect(await playWebviewSound("staplebops-06")).toBe(true)
    expect(failed.messages).toHaveLength(1)
    expect(fallback.messages).toEqual([{ type: "playNotificationSound", uri: "sound://fallback/staplebops-06.wav" }])
  })

  it("falls back when the preferred webview cannot resolve the sound URI", async () => {
    const fallback = target("fallback")
    const failed = registerSoundWebview(
      () => Promise.resolve(true),
      () => {
        throw new Error("disposed")
      },
    )
    disposables.push(failed)
    fallback.registration.ready()
    failed.ready()

    expect(await playWebviewSound("bip-bop-03")).toBe(true)
    expect(fallback.messages).toEqual([{ type: "playNotificationSound", uri: "sound://fallback/bip-bop-03.wav" }])
  })

  it("returns false when no ready webview exists", async () => {
    target("pending")
    expect(await playWebviewSound("yup-01")).toBe(false)
  })
})
