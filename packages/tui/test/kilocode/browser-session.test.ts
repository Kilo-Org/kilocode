import { describe, expect, test } from "bun:test"
import { adoptToast, noticeToast, shareToast } from "../../src/kilocode/browser-session"

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
