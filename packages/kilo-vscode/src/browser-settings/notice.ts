// SPEC D2: the backend defaults to Playwright, and the first time a browser extension is seen connected, a Playwright
// user is offered the switch, once. With the Playwright backend the CLI never dials a hub, so the sighting comes from
// the hub registry the status already reads (`status.ts`); the config is read only once an extension is connected.
import type { BrowserSettings, Service } from "./index"
import type { Extension } from "./status"

export namespace BrowserNotice {
  /** The global-state key that records the first sighting, whether or not it offered the switch. */
  export const KEY = "kilo-code.v2.browser.extensionNoticeSeen"
  /** How often the registry is read until the first sighting; a directory listing and a few small files. */
  export const INTERVAL = 5_000

  /** What one check decides: keep watching, record the sighting quietly, or record it and offer the switch. */
  export type Decision = { kind: "wait" } | { kind: "seen" } | { kind: "offer"; browser: string }

  /**
   * The first connected extension is the one moment the notice belongs to. A user already on the extension backend, or
   * one who turned the tools off, made the choice the notice would offer, so that sighting is recorded without one.
   */
  export function decide(input: { seen: boolean; extension: Extension; backend?: BrowserSettings.Backend }): Decision {
    if (input.seen || input.extension.state !== "connected" || input.backend === undefined) return { kind: "wait" }
    if (input.backend !== "playwright") return { kind: "seen" }
    return { kind: "offer", browser: input.extension.browser }
  }

  export type Store = {
    get<T>(key: string): T | undefined
    update(key: string, value: unknown): PromiseLike<void>
  }

  /**
   * Check the registry every `INTERVAL` until the first sighting. `show` presents the offer and answers whether the
   * user took it; the sighting is stored before the offer shows, so a reload while it is open never offers it again.
   */
  export function watch(input: {
    service: Pick<Service, "status" | "read" | "write">
    store: Store
    show: (browser: string) => PromiseLike<boolean>
    log?: (...args: unknown[]) => void
    interval?: number
  }) {
    const seen = () => input.store.get<boolean>(KEY) === true
    // One check at a time: an open offer can wait minutes for the user while the timer keeps ticking.
    let running = false
    const check = async () => {
      if (running || seen()) return
      running = true
      try {
        await step()
      } finally {
        running = false
      }
    }
    const step = async () => {
      const status = await input.service.status()
      if (status.extension.state !== "connected") return
      // The server may still be starting; the next tick reads the backend again.
      const backend = await input.service.read().then(
        (state) => state.backend,
        (error: unknown) => {
          input.log?.("cannot read the backend for the extension notice:", error)
          return undefined
        },
      )
      const decision = decide({ seen: seen(), extension: status.extension, backend })
      if (decision.kind === "wait") return
      await input.store.update(KEY, true)
      stop()
      if (decision.kind === "seen") return
      if (!(await input.show(decision.browser))) return
      await input.service.write({ browser: { backend: "extension" } })
    }
    const timer = seen()
      ? undefined
      : setInterval(
          () => void check().catch((error: unknown) => input.log?.("extension notice failed:", error)),
          input.interval ?? INTERVAL,
        )
    const stop = () => clearInterval(timer)
    return { check, dispose: stop }
  }
}
