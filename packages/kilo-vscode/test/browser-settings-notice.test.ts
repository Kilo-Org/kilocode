import { describe, expect, test } from "bun:test"
import type { BrowserSettings } from "../src/browser-settings"
import { BrowserNotice } from "../src/browser-settings/notice"
import type { Extension } from "../src/browser-settings/status"

const connected: Extension = { state: "connected", browser: "Chrome", profile: "Work" }

describe("extension notice decision", () => {
  test("a Playwright user is offered the switch the first time an extension is connected", () => {
    expect(BrowserNotice.decide({ seen: false, extension: connected, backend: "playwright" })).toEqual({
      kind: "offer",
      browser: "Chrome",
    })
  })

  test("nothing happens before an extension is connected, or once the sighting is recorded", () => {
    expect(BrowserNotice.decide({ seen: false, extension: { state: "none" }, backend: "playwright" })).toEqual({
      kind: "wait",
    })
    expect(BrowserNotice.decide({ seen: false, extension: { state: "waiting" }, backend: "playwright" })).toEqual({
      kind: "wait",
    })
    expect(BrowserNotice.decide({ seen: true, extension: connected, backend: "playwright" })).toEqual({ kind: "wait" })
  })

  test("a user who already chose the extension or turned the tools off gets the sighting recorded without an offer", () => {
    expect(BrowserNotice.decide({ seen: false, extension: connected, backend: "extension" })).toEqual({ kind: "seen" })
    expect(BrowserNotice.decide({ seen: false, extension: connected, backend: "off" })).toEqual({ kind: "seen" })
  })

  test("an unknown backend waits for the next check instead of deciding", () => {
    expect(BrowserNotice.decide({ seen: false, extension: connected })).toEqual({ kind: "wait" })
  })
})

describe("extension notice watcher", () => {
  /** Global state as VS Code keeps it: one value per key, surviving a new watcher (a reload). */
  function globalState() {
    const values = new Map<string, unknown>()
    return {
      get: <T>(key: string) => values.get(key) as T | undefined,
      update: async (key: string, value: unknown) => void values.set(key, value),
    }
  }

  /** Every offer shown, declined unless `accept` says otherwise. */
  function offers(accept = false) {
    const shown: string[] = []
    return {
      shown,
      show: async (browser: string) => {
        shown.push(browser)
        return accept
      },
    }
  }

  const base: BrowserSettings.State = {
    backend: "playwright",
    observation: "diff",
    allow_sensitive: false,
    rules: [],
    allowAll: false,
  }

  /** The settings service: a registry status and a config backend the test sets, and the writes it receives. */
  function service(input: { extension: Extension; backend: BrowserSettings.Backend | Error }) {
    const writes: unknown[] = []
    return {
      input,
      writes,
      api: {
        status: async () => ({ playwright: { ready: true }, extension: input.extension }),
        read: async () => {
          if (input.backend instanceof Error) throw input.backend
          return { ...base, backend: input.backend }
        },
        write: async (patch: unknown) => {
          writes.push(patch)
          return { ...base, backend: "extension" as const }
        },
      },
    }
  }

  test("offers once, persists it, and a reload never offers again", async () => {
    const store = globalState()
    const fake = service({ extension: { state: "waiting" }, backend: "playwright" })
    const { shown, show } = offers()
    const first = BrowserNotice.watch({ service: fake.api, store, show, interval: 60_000 })
    await first.check()
    expect(shown).toEqual([])

    fake.input.extension = connected
    await first.check()
    await first.check()
    expect(shown).toEqual(["Chrome"])
    expect(store.get(BrowserNotice.KEY)).toBe(true)
    first.dispose()

    const reloaded = BrowserNotice.watch({ service: fake.api, store, show, interval: 60_000 })
    await reloaded.check()
    reloaded.dispose()
    expect(shown).toEqual(["Chrome"])
    expect(fake.writes).toEqual([])
  })

  test("taking the offer writes only the extension backend", async () => {
    const fake = service({ extension: connected, backend: "playwright" })
    const watcher = BrowserNotice.watch({ service: fake.api, store: globalState(), show: offers(true).show, interval: 60_000 })
    await watcher.check()
    watcher.dispose()
    expect(fake.writes).toEqual([{ browser: { backend: "extension" } }])
  })

  test("a backend that cannot be read yet leaves the sighting for the next check", async () => {
    const store = globalState()
    const fake = service({ extension: connected, backend: new Error("server starting") })
    const { shown, show } = offers()
    const watcher = BrowserNotice.watch({ service: fake.api, store, show, interval: 60_000 })
    await watcher.check()
    expect(shown).toEqual([])
    expect(store.get(BrowserNotice.KEY)).toBeUndefined()

    fake.input.backend = "playwright"
    await watcher.check()
    watcher.dispose()
    expect(shown).toEqual(["Chrome"])
  })

  test("an extension user's first sighting is recorded without an offer, so a later switch to Playwright stays quiet", async () => {
    const store = globalState()
    const fake = service({ extension: connected, backend: "extension" })
    const { shown, show } = offers()
    const watcher = BrowserNotice.watch({ service: fake.api, store, show, interval: 60_000 })
    await watcher.check()
    fake.input.backend = "playwright"
    await watcher.check()
    watcher.dispose()
    expect(shown).toEqual([])
    expect(store.get(BrowserNotice.KEY)).toBe(true)
  })
})
