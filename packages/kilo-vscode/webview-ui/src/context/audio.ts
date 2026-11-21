type Media = {
  addEventListener(type: "ended" | "error", listener: () => void, options: AddEventListenerOptions): void
  load(): void
  pause(): void
  play(): Promise<void>
  removeAttribute(name: string): void
}

type Timer = ReturnType<typeof setTimeout>

type Options = {
  audio: (uri: string) => Media
  clear: (timer: Timer) => void
  fail: (error: unknown) => void
  timeout: number
  wait: (callback: () => void, delay: number) => Timer
}

const defaults: Options = {
  audio: (uri) => new Audio(uri),
  clear: (timer) => clearTimeout(timer),
  fail: (error) => console.warn("[Kilo New] notification sound playback failed", { error }),
  timeout: 10_000,
  wait: (callback, delay) => setTimeout(callback, delay),
}

export function createPlayer(options: Partial<Options> = {}) {
  const opts = { ...defaults, ...options }
  let active: { audio: Media; ctrl: AbortController; done: boolean; timer: Timer | undefined } | undefined

  const stop = (item: NonNullable<typeof active>, error?: unknown) => {
    if (item.done) return
    item.done = true
    if (item.timer !== undefined) opts.clear(item.timer)
    item.ctrl.abort()
    item.audio.pause()
    item.audio.removeAttribute("src")
    item.audio.load()
    if (active === item) active = undefined
    if (error !== undefined) opts.fail(error)
  }

  return {
    play(uri: string) {
      if (active) stop(active)
      const audio = opts.audio(uri)
      const item = { audio, ctrl: new AbortController(), done: false, timer: undefined as Timer | undefined }
      active = item
      audio.addEventListener("ended", () => stop(item), { once: true, signal: item.ctrl.signal })
      audio.addEventListener("error", () => stop(item, new Error("Notification sound failed to load")), {
        once: true,
        signal: item.ctrl.signal,
      })
      item.timer = opts.wait(() => stop(item, new Error("Notification sound playback timed out")), opts.timeout)
      void audio.play().catch((error) => stop(item, error))
    },
    dispose() {
      if (active) stop(active)
    },
  }
}
