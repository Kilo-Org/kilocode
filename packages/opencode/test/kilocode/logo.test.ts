import { describe, expect, test } from "bun:test"
import { plain, session, supports, tui } from "../../src/kilocode/cli/logo"

describe("kilocode logo", () => {
  test("falls back on remote terminals", () => {
    expect(supports({ SSH_TTY: "/dev/pts/0" }, "linux")).toBe(false)
    expect(supports({ SSH_CLIENT: "127.0.0.1 12345 22" }, "linux")).toBe(false)
    expect(supports({ SSH_CONNECTION: "127.0.0.1 12345 127.0.0.1 22" }, "linux")).toBe(false)
  })

  test("allows Windows Terminal locally", () => {
    expect(supports({}, "win32")).toBe(true)
    expect(supports({ WT_SESSION: "session" }, "linux")).toBe(true)
  })

  test("allows an override", () => {
    expect(supports({ KILO_UNICODE_LOGO: "1", SSH_TTY: "/dev/pts/0" }, "linux")).toBe(true)
    expect(supports({ KILO_UNICODE_LOGO: "0" }, "linux")).toBe(false)
  })

  test("uses modern and fallback logo variants", () => {
    expect(tui({ KILO_UNICODE_LOGO: "1" }, "linux").join("\n")).toContain("🬺🬏")
    expect(tui({ SSH_TTY: "/dev/pts/0" }, "linux").join("\n")).not.toContain("🬺🬏")
    expect(plain({ SSH_TTY: "/dev/pts/0" }, "linux").join("\n")).not.toContain("🬁🬬")
  })

  test("formats child session exit logo", () => {
    const out = session("Title", "ses_test", "<dim>", "<reset>", { SSH_TTY: "/dev/pts/0" }, "linux")
    expect(out).toContain("<dim>Title<reset>")
    expect(out).not.toContain("🬺🬏")
  })
})
