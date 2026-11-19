import { describe, expect, test } from "bun:test"
import { adoptToast, noticeToast, shareToast, whenStarted } from "../../src/kilocode/browser-session"

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
