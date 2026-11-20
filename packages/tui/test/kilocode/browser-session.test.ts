import { describe, expect, test } from "bun:test"
import type { KiloBrowserRpc } from "@opencode/schema/kilocode/browser"
import { adoptToast, browserSession, noticeToast, shareToast, whenStarted } from "../../src/kilocode/browser-session"

const hint =
  'Install the Kilo browser extension and turn on "Allow local agents" in its settings, or set browser.backend to "playwright".'

describe("/browser share and adopt answers", () => {
  test("a share names the outcome: shared, the setup step, the refusal, or the backend to choose", () => {
    expect(shareToast({ kind: "shared" })).toEqual({
      variant: "success",
      message: "Your active tab is now in this session's tab group.",
    })
    expect(shareToast({ kind: "unavailable", hint })).toEqual({
      variant: "warning",
      title: "Browser not available",
      message: hint,
      duration: 10000,
    })
    expect(shareToast({ kind: "refused", message: "The browser has no active tab to share." })).toEqual({
      variant: "error",
      message: "The browser has no active tab to share.",
      duration: 10000,
    })
    expect(shareToast({ kind: "not_extension" }).message).toBe(
      "Sharing and reusing tabs need the Kilo browser extension. Choose it in /browser.",
    )
  })

  test("an adopt says whether a group was reused, none had ended, the session kept its tabs, or it is unknown", () => {
    expect(adoptToast({ kind: "adopted" })).toEqual({
      variant: "success",
      message: "This session now uses the last ended tab group.",
    })
    expect(adoptToast({ kind: "none" }).message).toBe("There is no ended tab group to reuse.")
    expect(adoptToast({ kind: "kept" }).message).toBe("This session already has its own tabs and keeps them.")
    expect(adoptToast({ kind: "unconfirmed" }).message).toContain("Update the Kilo browser extension")
    expect(adoptToast({ kind: "unavailable", hint }).message).toBe(hint)
  })

  test("an organization that turned browser control off says so instead of asking to choose the extension", () => {
    for (const toast of [shareToast({ kind: "organization_off" }), adoptToast({ kind: "organization_off" })])
      expect(toast).toEqual({
        variant: "warning",
        message: "Your organization turned off browser control in Kilo.",
        duration: 10000,
      })
  })
})

describe("/browser share and adopt typed while Kilo starts", () => {
  // What the promise client throws while the location's plugins are not registered yet, and also for a call whose
  // location shut down while the handler ran.
  const unavailable = { type: "rpc.unavailable", message: "RPC is unavailable: kilocode.browser" }

  /** A location that lists no plugin on its first `count` reads and its plugins after that. */
  const location = (count: number, log: string[]) => {
    let reads = 0
    return async () => {
      log.push("plugins")
      reads += 1
      return { data: reads > count ? ["kilocode.browser"] : [] }
    }
  }

  test("an adopt waits until the location lists its plugins, then calls once and reports the adopt", async () => {
    const log: string[] = []
    const adopt = async () => {
      log.push("adopt")
      return adoptToast({ kind: "adopted" })
    }
    expect(await whenStarted(adopt, location(1, log))).toEqual({
      variant: "success",
      message: "This session now uses the last ended tab group.",
    })
    expect(log).toEqual(["plugins", "plugins", "adopt"])
  })

  test("a share on a location that already lists its plugins calls at once", async () => {
    const log: string[] = []
    const share = async () => {
      log.push("share")
      return shareToast({ kind: "shared" })
    }
    expect(await whenStarted(share, location(0, log))).toEqual({
      variant: "success",
      message: "Your active tab is now in this session's tab group.",
    })
    expect(log).toEqual(["plugins", "share"])
  })

  test("an rpc.unavailable answer is never called again and says Kilo is starting, not the RPC error", async () => {
    // The location listed its plugins, so the handler may have run before the location shut down: a second adopt
    // could re-key another ended group.
    for (const name of ["share", "adopt"]) {
      const log: string[] = []
      const call = async () => {
        log.push(name)
        throw unavailable
      }
      const toast = await whenStarted(call, location(0, log))
      expect(toast).toEqual({ variant: "warning", message: "Kilo is still starting. Try again in a moment." })
      expect(JSON.stringify(toast)).not.toContain("RPC is unavailable")
      expect(log).toEqual(["plugins", name])
    }
  })

  test("any other failure rejects unchanged", async () => {
    const log: string[] = []
    const failure = { type: "rpc.internal", message: "RPC call failed" }
    const share = async () => {
      log.push("share")
      throw failure
    }
    await expect(whenStarted(share, location(0, log))).rejects.toBe(failure)
    expect(log).toEqual(["plugins", "share"])
  })

  test("the wait asks less often as it goes, 100 ms doubling to at most 1 s, and still ends after 10 s", async () => {
    const log: string[] = []
    const waits: number[] = []
    let now = 0
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        waits.push(ms)
        now += ms
      },
    }
    const share = async () => {
      log.push("share")
      return shareToast({ kind: "shared" })
    }
    // The location never lists its plugins: the command still calls once when the wait ends.
    await whenStarted(share, location(Infinity, log), clock)
    expect(waits).toEqual([100, 200, 400, 800, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 500])
    expect(now).toBe(10_000)
    expect(log.filter((entry) => entry === "plugins")).toHaveLength(waits.length)
    expect(log.at(-1)).toBe("share")
  })
})

describe("browser notices", () => {
  test("an unavailable browser shows the setup step, not the model's sentence", () => {
    expect(noticeToast({ kind: "unavailable", sessionID: "ses_a" as never, hint })).toEqual({
      sessionID: "ses_a",
      duration: 10000,
      variant: "warning",
      title: "Browser not available",
      message: hint,
    })
  })

  test("a stopped session tells the user how to give it its tabs back", () => {
    expect(noticeToast({ kind: "stopped", sessionID: "ses_a" as never })).toEqual({
      sessionID: "ses_a",
      duration: 10000,
      variant: "info",
      message: "You stopped the browser for this session. Run /browser adopt to give it its tabs back.",
    })
  })

  test("an outdated extension shows the update step", () => {
    expect(noticeToast({ kind: "outdated", sessionID: "ses_a" as never, hint: "Update it." }).title).toBe(
      "Browser extension out of date",
    )
  })
})

describe("browser notices in the TUI", () => {
  /**
   * `browserSession` over a stand-in plugin context: the `kilocode.browser` RPC answers `share` and `adopt` with the
   * given results, `notice` raises one event, and every toast lands in `toasts`.
   */
  function harness(answers: { share?: KiloBrowserRpc.Share; adopt?: KiloBrowserRpc.Adopt } = {}) {
    const toasts: { message: string; sessionID?: string }[] = []
    const listeners: ((event: { data: KiloBrowserRpc.Notice }) => void)[] = []
    const rpc = {
      share: async () => answers.share ?? { kind: "shared" },
      adopt: async () => answers.adopt ?? { kind: "adopted" },
      events: {
        on: (_: "notice", listener: (event: { data: KiloBrowserRpc.Notice }) => void) => {
          listeners.push(listener)
          return () => void listeners.splice(listeners.indexOf(listener), 1)
        },
      },
    }
    const context = {
      client: { rpc: () => rpc, plugin: { list: async () => ({ data: ["kilocode.browser"] }) } },
      ui: {
        toast: { show: (toast: { message: string; sessionID?: string }) => void toasts.push(toast) },
        // `/browser share` and `/browser adopt` act on the routed session.
        router: { current: () => ({ type: "session", sessionID: "ses_a" }) },
      },
      data: { session: { get: () => undefined } },
    }
    const session = browserSession(context as never)
    const off = session.watch()
    return {
      toasts,
      session,
      off,
      /** One failed call's notice: `stopped`, or `unavailable` with the setup step. */
      notice: (input: { kind: "stopped" | "unavailable"; sessionID: string }) => {
        const sessionID = input.sessionID as never
        const data: KiloBrowserRpc.Notice =
          input.kind === "stopped" ? { kind: "stopped", sessionID } : { kind: "unavailable", sessionID, hint }
        for (const listener of [...listeners]) listener({ data })
      },
    }
  }

  test("the same notice for the same session shows once; another kind or session shows", () => {
    const host = harness()
    host.notice({ kind: "stopped", sessionID: "ses_a" })
    host.notice({ kind: "stopped", sessionID: "ses_a" })
    expect(host.toasts.map((toast) => toast.sessionID)).toEqual(["ses_a"])
    host.notice({ kind: "unavailable", sessionID: "ses_a" })
    host.notice({ kind: "stopped", sessionID: "ses_b" })
    host.notice({ kind: "unavailable", sessionID: "ses_a" })
    expect(host.toasts.map((toast) => [toast.sessionID, toast.message])).toEqual([
      ["ses_a", "You stopped the browser for this session. Run /browser adopt to give it its tabs back."],
      ["ses_a", hint],
      ["ses_b", "You stopped the browser for this session. Run /browser adopt to give it its tabs back."],
    ])
  })

  test("a successful share or adopt shows that session's next notice again, and only that session's", async () => {
    for (const act of ["share", "adopt"] as const) {
      const host = harness()
      host.notice({ kind: "stopped", sessionID: "ses_a" })
      host.notice({ kind: "stopped", sessionID: "ses_b" })
      await host.session[act]()
      host.notice({ kind: "stopped", sessionID: "ses_a" })
      host.notice({ kind: "stopped", sessionID: "ses_b" })
      expect(host.toasts.map((toast) => toast.sessionID ?? act)).toEqual(["ses_a", "ses_b", act, "ses_a"])
    }
  })

  test("a share that did not succeed keeps the notice shown once", async () => {
    const host = harness({ share: { kind: "not_extension" } })
    host.notice({ kind: "stopped", sessionID: "ses_a" })
    await host.session.share()
    host.notice({ kind: "stopped", sessionID: "ses_a" })
    expect(host.toasts.map((toast) => toast.sessionID ?? "share")).toEqual(["ses_a", "share"])
  })

  test("unsubscribing stops the notices", () => {
    const host = harness()
    host.off()
    host.notice({ kind: "stopped", sessionID: "ses_a" })
    expect(host.toasts).toEqual([])
  })
})
