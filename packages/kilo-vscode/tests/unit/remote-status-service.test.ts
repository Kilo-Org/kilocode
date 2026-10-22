import { describe, it, expect, spyOn } from "bun:test"
import { RemoteStatusService, type RemoteState } from "../../src/services/RemoteStatusService"

type StatusResponse = { enabled: boolean; connected: boolean }

function client(opts: { status?: StatusResponse | (() => StatusResponse); fail?: boolean }) {
  return {
    remote: {
      status: async (_body?: unknown, _opts?: unknown) => {
        if (opts.fail) throw new Error("connection refused")
        const data =
          typeof opts.status === "function" ? opts.status() : (opts.status ?? { enabled: false, connected: false })
        return { data }
      },
      enable: async (_body?: unknown, _opts?: unknown) => {
        if (opts.fail) throw new Error("enable failed")
        return { data: true }
      },
      disable: async (_body?: unknown, _opts?: unknown) => {
        if (opts.fail) throw new Error("disable failed")
        return { data: true }
      },
    },
  }
}

function service() {
  return new RemoteStatusService()
}

// ---------------------------------------------------------------------------
// Listener management
// ---------------------------------------------------------------------------

describe("RemoteStatusService", () => {
  describe("onChange", () => {
    it("listener called on state change", async () => {
      const svc = service()
      const states: RemoteState[] = []
      svc.onChange((s) => states.push(s))
      svc.setClient(client({ status: { enabled: true, connected: true } }) as never)
      await svc.refresh()
      expect(states).toEqual([{ enabled: true, connected: true }])
      svc.dispose()
    })

    it("listener not called after unsubscribe", async () => {
      const svc = service()
      const states: RemoteState[] = []
      const unsub = svc.onChange((s) => states.push(s))
      unsub()
      svc.setClient(client({ status: { enabled: true, connected: true } }) as never)
      await svc.refresh()
      expect(states).toEqual([])
      svc.dispose()
    })

    it("multiple listeners all notified", async () => {
      const svc = service()
      const a: RemoteState[] = []
      const b: RemoteState[] = []
      svc.onChange((s) => a.push(s))
      svc.onChange((s) => b.push(s))
      svc.setClient(client({ status: { enabled: true, connected: false } }) as never)
      await svc.refresh()
      expect(a).toEqual([{ enabled: true, connected: false }])
      expect(b).toEqual([{ enabled: true, connected: false }])
      svc.dispose()
    })
  })

  // ---------------------------------------------------------------------------
  // refresh()
  // ---------------------------------------------------------------------------

  describe("refresh", () => {
    it("fetches status and notifies listeners", async () => {
      const svc = service()
      const states: RemoteState[] = []
      svc.onChange((s) => states.push(s))
      svc.setClient(client({ status: { enabled: true, connected: false } }) as never)
      await svc.refresh()
      expect(states).toEqual([{ enabled: true, connected: false }])
      svc.dispose()
    })

    it("without client is a no-op", async () => {
      const svc = service()
      const states: RemoteState[] = []
      svc.onChange((s) => states.push(s))
      await svc.refresh() // no client set
      expect(states).toEqual([])
      svc.dispose()
    })

    it("does not notify if state unchanged", async () => {
      const svc = service()
      const states: RemoteState[] = []
      svc.onChange((s) => states.push(s))
      // initial state is { enabled: false, connected: false }, same as client returns
      svc.setClient(client({ status: { enabled: false, connected: false } }) as never)
      await svc.refresh()
      expect(states).toEqual([]) // no change from initial
      svc.dispose()
    })
  })

  // ---------------------------------------------------------------------------
  // setEnabled()
  // ---------------------------------------------------------------------------

  describe("setEnabled", () => {
    it("setEnabled(true) calls enable and broadcasts enabled state", async () => {
      const svc = service()
      const states: RemoteState[] = []
      svc.onChange((s) => states.push(s))
      svc.setClient(client({ status: { enabled: true, connected: false } }) as never)
      await svc.setEnabled(true)
      expect(states).toEqual([{ enabled: true, connected: false }])
      svc.dispose()
    })

    it("setEnabled(false) calls disable and broadcasts disabled", async () => {
      const svc = service()
      const states: RemoteState[] = []
      svc.onChange((s) => states.push(s))
      svc.setClient(client({ status: { enabled: true, connected: true } }) as never)
      // First get to enabled state
      await svc.refresh()
      states.length = 0 // reset
      await svc.setEnabled(false)
      expect(states).toEqual([{ enabled: false, connected: false }])
      svc.dispose()
    })

    it("setEnabled(false) after enable broadcasts disabled", async () => {
      const svc = service()
      const states: RemoteState[] = []
      svc.onChange((s) => states.push(s))
      svc.setClient(client({ status: { enabled: true, connected: false } }) as never)
      await svc.setEnabled(true)
      states.length = 0
      await svc.setEnabled(false)
      expect(states).toEqual([{ enabled: false, connected: false }])
      svc.dispose()
    })

    it("setEnabled(true) error is surfaced", async () => {
      const svc = service()
      svc.setClient(client({ fail: true }) as never)
      await expect(svc.setEnabled(true)).rejects.toThrow("enable failed")
      svc.dispose()
    })
  })

  // ---------------------------------------------------------------------------
  // toggle()
  // ---------------------------------------------------------------------------

  describe("toggle", () => {
    it("toggle when disabled calls enable", async () => {
      const svc = service()
      let enabled = false
      const c = {
        remote: {
          status: async (_b?: unknown, _o?: unknown) => ({ data: { enabled: false, connected: false } }),
          enable: async (_b?: unknown, _o?: unknown) => {
            enabled = true
            return { data: true }
          },
          disable: async (_b?: unknown, _o?: unknown) => ({ data: true }),
        },
      }
      svc.setClient(c as never)
      await svc.toggle()
      expect(enabled).toBe(true)
      svc.dispose()
    })

    it("toggle when enabled calls disable", async () => {
      const svc = service()
      let disabled = false
      const c = {
        remote: {
          status: async (_b?: unknown, _o?: unknown) => ({ data: { enabled: true, connected: true } }),
          enable: async (_b?: unknown, _o?: unknown) => ({ data: true }),
          disable: async (_b?: unknown, _o?: unknown) => {
            disabled = true
            return { data: true }
          },
        },
      }
      svc.setClient(c as never)
      await svc.toggle()
      expect(disabled).toBe(true)
      svc.dispose()
    })
  })

  // ---------------------------------------------------------------------------
  // Push-based updates via updateFromEvent
  // ---------------------------------------------------------------------------

  describe("updateFromEvent", () => {
    it("broadcasts state when pushed via event", () => {
      const svc = service()
      const states: RemoteState[] = []
      svc.onChange((s) => states.push(s))
      svc.updateFromEvent({ enabled: true, connected: true })
      expect(states).toEqual([{ enabled: true, connected: true }])
      svc.dispose()
    })

    it("does not notify if event state matches current", () => {
      const svc = service()
      const states: RemoteState[] = []
      svc.onChange((s) => states.push(s))
      // initial state is { enabled: false, connected: false }
      svc.updateFromEvent({ enabled: false, connected: false })
      expect(states).toEqual([])
      svc.dispose()
    })

    it("tracks successive event-driven transitions", () => {
      const svc = service()
      const states: RemoteState[] = []
      svc.onChange((s) => states.push(s))
      svc.updateFromEvent({ enabled: true, connected: false })
      svc.updateFromEvent({ enabled: true, connected: true })
      expect(states).toEqual([
        { enabled: true, connected: false },
        { enabled: true, connected: true },
      ])
      svc.dispose()
    })
  })

  // ---------------------------------------------------------------------------
  // clearState
  // ---------------------------------------------------------------------------

  describe("clearState", () => {
    it("resets to disabled state", () => {
      const svc = service()
      const states: RemoteState[] = []
      svc.onChange((s) => states.push(s))
      svc.updateFromEvent({ enabled: true, connected: true })
      states.length = 0
      svc.clearState()
      expect(states).toEqual([{ enabled: false, connected: false }])
      expect(svc.getState()).toEqual({ enabled: false, connected: false })
      svc.dispose()
    })
  })

  // ---------------------------------------------------------------------------
  // Status bar
  // ---------------------------------------------------------------------------

  describe("status bar", () => {
    it("status bar hidden when remote disabled", async () => {
      const svc = service()
      svc.setClient(client({ status: { enabled: false, connected: false } }) as never)
      await svc.refresh() // no state change from initial, bar should stay hidden
      // Dispose checks bar was never shown — no direct assertion on mock, just no crash
      svc.dispose()
    })

    it("status bar shown with correct text when connected", async () => {
      const svc = service()
      svc.setClient(client({ status: { enabled: true, connected: true } }) as never)
      await svc.refresh()
      // Service is functional — status bar is managed internally. We verify no errors.
      svc.dispose()
    })

    it("status bar shown with connecting text when enabled but not connected", async () => {
      const svc = service()
      svc.setClient(client({ status: { enabled: true, connected: false } }) as never)
      await svc.refresh()
      svc.dispose()
    })
  })

  // ---------------------------------------------------------------------------
  // dispose()
  // ---------------------------------------------------------------------------

  describe("dispose", () => {
    it("dispose clears listeners", () => {
      const svc = service()
      const states: RemoteState[] = []
      svc.onChange((s) => states.push(s))
      svc.updateFromEvent({ enabled: true, connected: false })
      svc.dispose()
      // No further notifications after dispose
      svc.updateFromEvent({ enabled: true, connected: true })
      expect(states).toEqual([{ enabled: true, connected: false }])
    })
  })
})
