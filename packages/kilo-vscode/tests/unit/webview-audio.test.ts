import { describe, expect, it } from "bun:test"
import { createPlayer } from "../../webview-ui/src/context/audio"

class Audio {
  readonly gate = Promise.withResolvers<void>()
  readonly listeners = new Map<string, () => void>()
  signal: AbortSignal | undefined
  loaded = false
  paused = false
  removed = false

  addEventListener(type: "ended" | "error", listener: () => void, options: AddEventListenerOptions) {
    this.listeners.set(type, listener)
    this.signal = options.signal ?? undefined
  }

  load() {
    this.loaded = true
  }

  pause() {
    this.paused = true
  }

  play() {
    return this.gate.promise
  }

  removeAttribute(name: string) {
    if (name === "src") this.removed = true
  }

  emit(type: "ended" | "error") {
    this.listeners.get(type)?.()
  }
}

describe("webview notification audio", () => {
  it("continues the queue after a stalled sound times out", async () => {
    const media: Audio[] = []
    const timers: Array<() => void> = []
    const cleared: number[] = []
    const delays: number[] = []
    const play = createPlayer({
      audio: () => {
        const audio = new Audio()
        media.push(audio)
        return audio
      },
      clear: (timer) => cleared.push(timer as number),
      wait: (callback, delay) => {
        timers.push(callback)
        delays.push(delay)
        return timers.length as ReturnType<typeof setTimeout>
      },
    })

    const errors: unknown[] = []
    const stalled = play("stalled.wav").catch((error) => errors.push(error))
    const next = play("next.wav")
    await Promise.resolve()
    expect(media).toHaveLength(1)
    expect(delays).toEqual([10_000])

    timers[0]()
    await stalled
    await Promise.resolve()
    expect(errors).toEqual([new Error("Notification sound playback timed out")])
    expect(media[0].paused).toBe(true)
    expect(media[0].removed).toBe(true)
    expect(media[0].loaded).toBe(true)
    expect(media[0].signal?.aborted).toBe(true)
    expect(cleared).toEqual([1])
    expect(media).toHaveLength(2)

    media[0].gate.reject(new Error("late rejection"))
    await Promise.resolve()
    expect(cleared).toEqual([1])

    media[1].emit("ended")
    await expect(next).resolves.toBeUndefined()
    expect(cleared).toEqual([1, 2])
  })
})
