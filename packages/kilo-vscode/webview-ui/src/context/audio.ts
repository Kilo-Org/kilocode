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
  timeout: number
  wait: (callback: () => void, delay: number) => Timer
}

const defaults: Options = {
  audio: (uri) => new Audio(uri),
  clear: (timer) => clearTimeout(timer),
  timeout: 10_000,
  wait: (callback, delay) => setTimeout(callback, delay),
}

export function createPlayer(options: Partial<Options> = {}) {
  const opts = { ...defaults, ...options }
  let sounds = Promise.resolve()

  return (uri: string) => {
    const run = () =>
      new Promise<void>((resolve, reject) => {
        const audio = opts.audio(uri)
        const ctrl = new AbortController()
        let settled = false
        const finish = (done: () => void) => {
          if (settled) return
          settled = true
          opts.clear(timer)
          ctrl.abort()
          done()
        }
        const timer = opts.wait(
          () =>
            finish(() => {
              audio.pause()
              audio.removeAttribute("src")
              audio.load()
              reject(new Error("Notification sound playback timed out"))
            }),
          opts.timeout,
        )
        audio.addEventListener("ended", () => finish(resolve), { once: true, signal: ctrl.signal })
        audio.addEventListener("error", () => finish(() => reject(new Error("Notification sound failed to load"))), {
          once: true,
          signal: ctrl.signal,
        })
        audio.play().catch((error) => finish(() => reject(error)))
      })
    sounds = sounds.then(run, run)
    return sounds
  }
}
