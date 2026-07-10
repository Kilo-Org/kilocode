import { describe, expect, it } from "bun:test"
import { createPlayer } from "../../webview-ui/src/context/audio"

class Audio {
  readonly gate = Promise.withResolvers<void>()
  readonly listeners = new Map<string, { listener: () => void; signal?: AbortSignal }>()
  loaded = false
  paused = false
  removed = false

  addEventListener(type: "ended" | "error", listener: () => void, options: AddEventListenerOptions) {
    this.listeners.set(type, { listener, signal: options.signal ?? undefined })
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
    const event = this.listeners.get(type)
    if (!event?.signal?.aborted) event?.listener()
  }
}

function setup() {
  const media: Audio[] = []
  const timers = new Map<number, () => void>()
  let timer = 0
  const cleared: number[] = []
  const errors: unknown[] = []
  const delays: number[] = []
  const player = createPlayer({
    audio: () => {
      const audio = new Audio()
      media.push(audio)
      return audio
    },
    clear: (timer) => {
      cleared.push(timer as number)
    },
    fail: (error) => errors.push(error),
    wait: (callback, delay) => {
      timer += 1
      timers.set(timer, callback)
      delays.push(delay)
      return timer as ReturnType<typeof setTimeout>
    },
  })
  return { cleared, delays, errors, media, player, timers }
}

function expectReleased(audio: Audio) {
  expect(audio.paused).toBe(true)
  expect(audio.removed).toBe(true)
  expect(audio.loaded).toBe(true)
  expect(audio.listeners.get("ended")?.signal?.aborted).toBe(true)
  expect(audio.listeners.get("error")?.signal?.aborted).toBe(true)
}

describe("webview notification audio", () => {
  it("replaces and releases the active sound", async () => {
    const ctx = setup()
    ctx.player.play("first.wav")
    ctx.player.play("second.wav")

    expect(ctx.media).toHaveLength(2)
    expectReleased(ctx.media[0])
    expect(ctx.cleared).toEqual([1])
    expect(ctx.errors).toEqual([])

    ctx.media[0].gate.reject(new Error("late rejection"))
    ctx.timers.get(1)?.()
    await Promise.resolve()
    expect(ctx.errors).toEqual([])
    expect(ctx.media[1].paused).toBe(false)
  })

  it("releases a completed sound and the provider disposal", () => {
    const ctx = setup()
    ctx.player.play("ended.wav")
    ctx.media[0].emit("ended")
    expectReleased(ctx.media[0])

    ctx.player.play("disposed.wav")
    ctx.player.dispose()
    expectReleased(ctx.media[1])
    expect(ctx.errors).toEqual([])
  })

  it("releases and reports failed playback", async () => {
    const ctx = setup()
    ctx.player.play("rejected.wav")
    const error = new Error("blocked")
    ctx.media[0].gate.reject(error)
    await Promise.resolve()

    expectReleased(ctx.media[0])
    expect(ctx.errors).toEqual([error])
  })

  it("releases and reports a media error", () => {
    const ctx = setup()
    ctx.player.play("error.wav")
    ctx.media[0].emit("error")

    expectReleased(ctx.media[0])
    expect(ctx.errors).toEqual([new Error("Notification sound failed to load")])
    expect(ctx.cleared).toEqual([1])
  })

  it("releases stalled playback after the configured timeout", () => {
    const ctx = setup()
    ctx.player.play("stalled.wav")
    expect(ctx.delays).toEqual([10_000])

    ctx.timers.get(1)?.()

    expectReleased(ctx.media[0])
    expect(ctx.errors).toEqual([new Error("Notification sound playback timed out")])
    expect(ctx.cleared).toEqual([1])
  })
})
