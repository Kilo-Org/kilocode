import { describe, expect, test } from "bun:test"
import { BrowserPermission } from "../../kilo-plugin/src/browser/permission"
import { origin, parse, sites } from "../webview-ui/src/components/settings/browser-settings"
import { defaultAllow } from "../src/shared/browser-permissions"
import { requestTracker } from "../webview-ui/src/v2/browser-settings-requests"

const rule = (resource: string, effect: "allow" | "ask" | "deny" = "allow") => ({
  action: "browser",
  resource,
  effect,
})

describe("site table", () => {
  test("one row per origin, in the order the rules name it", () => {
    expect(sites([rule("read:https://example.com"), rule("read:https://kilo.ai")])).toEqual([
      { origin: "https://example.com", read: "allow", act: "ask", navigate: "ask" },
      { origin: "https://kilo.ai", read: "allow", act: "ask", navigate: "ask" },
    ])
  })

  test("a class without a rule shows the CLI's default", () => {
    const [row] = sites([rule("act:https://example.com", "deny")])
    expect(row).toEqual({ origin: "https://example.com", read: "ask", act: "deny", navigate: "ask" })
  })

  test("a localhost origin without a rule shows the allow the CLI applies", () => {
    const [row] = sites([rule("read:http://localhost:5173", "deny")])
    expect(row).toEqual({ origin: "http://localhost:5173", read: "deny", act: "allow", navigate: "allow" })
    // The wildcard host is not parsed by the CLI's default either, so it shows ask.
    expect(sites([rule("act:http://*.localhost:*")])[0]).toMatchObject({ read: "ask", navigate: "ask" })
  })

  test("every mirrored default matches the plugin's own default grant", () => {
    const origins = [
      "https://example.com",
      "https://example.com:443",
      "http://localhost",
      "http://localhost:3000",
      "https://app.localhost",
      "http://127.0.0.1:8080",
      "http://[::1]:3000",
      "http://::1",
      "https://notlocalhost.example",
      "https://localhost.example.com",
      "http://*.localhost:*",
    ]
    for (const value of origins) {
      expect({ origin: value, allow: defaultAllow(value) }).toEqual({
        origin: value,
        allow: BrowserPermission.defaultGrant({ class: "read", origin: value }),
      })
    }
  })

  test("a port and a second colon stay part of the origin", () => {
    const [row] = sites([rule("navigate:http://localhost:5173")])
    expect(row.origin).toBe("http://localhost:5173")
    expect(row.navigate).toBe("allow")
  })

  test("the allow-all catch-all and other actions are not rows", () => {
    expect(sites([rule("*"), { action: "shell", resource: "read:*", effect: "allow" }])).toEqual([])
  })

  test("a resource without a known class is ignored", () => {
    expect(sites([rule("download:https://example.com"), rule(":https://example.com")])).toEqual([])
  })
})

describe("resource parts", () => {
  test("the first colon splits the class from the origin", () => {
    expect(parse("read:https://example.com:8443")).toEqual({
      grant: "read",
      origin: "https://example.com:8443",
    })
  })

  test("a resource without both parts has none", () => {
    expect(parse("read")).toBeUndefined()
    expect(parse("read:")).toBeUndefined()
    expect(parse(":https://example.com")).toBeUndefined()
  })
})

describe("the origin field", () => {
  test("keeps a valid origin", () => {
    expect(origin("https://example.com")).toEqual({ value: "https://example.com" })
  })

  test("a port and a wildcard host are valid", () => {
    expect(origin("http://localhost:5173")).toEqual({ value: "http://localhost:5173" })
    expect(origin("http://*.localhost:*")).toEqual({ value: "http://*.localhost:*" })
    expect(origin("http://127.0.0.1:3000")).toEqual({ value: "http://127.0.0.1:3000" })
  })

  test("surrounding space, case and a trailing slash are normalized away", () => {
    expect(origin("  HTTPS://Example.COM/ ")).toEqual({ value: "https://example.com" })
  })

  test("a path, a query or no scheme is refused", () => {
    expect(origin("https://example.com/docs")).toEqual({ error: "invalid" })
    expect(origin("https://example.com?q=1")).toEqual({ error: "invalid" })
    expect(origin("example.com")).toEqual({ error: "invalid" })
    expect(origin("ftp://example.com")).toEqual({ error: "invalid" })
  })

  test("an empty field says so instead of failing as invalid", () => {
    expect(origin("   ")).toEqual({ error: "empty" })
  })

  test("an origin already listed is a duplicate", () => {
    expect(origin("https://example.com/", ["https://example.com"])).toEqual({ error: "duplicate" })
  })

  test("a default port is dropped, because the protocol's origin has none", () => {
    expect(origin("https://example.com:443")).toEqual({ value: "https://example.com" })
    expect(origin("http://example.com:80")).toEqual({ value: "http://example.com" })
    expect(origin("http://localhost:80")).toEqual({ value: "http://localhost" })
    // A port that is not the scheme's default still names a different origin, and stays.
    expect(origin("https://example.com:80")).toEqual({ value: "https://example.com:80" })
    expect(origin("http://example.com:443")).toEqual({ value: "http://example.com:443" })
    expect(origin("http://example.com:8080")).toEqual({ value: "http://example.com:8080" })
  })

  test("the default port form matches the listed origin", () => {
    expect(origin("https://example.com:443/", ["https://example.com"])).toEqual({ error: "duplicate" })
  })
})

describe("browser settings requests", () => {
  test("one attempt per operation: a write does not drop a pending read", () => {
    const tracker = requestTracker()
    const read = tracker.start("read")
    const write = tracker.start("write")
    expect(tracker.accepts(read)).toBe(true)
    expect(tracker.accepts(write)).toBe(true)
    expect(tracker.kindOf(read)).toBe("read")
    expect(tracker.kindOf(write)).toBe("write")
  })

  test("a late reply of the same operation is dropped", () => {
    const tracker = requestTracker()
    const first = tracker.start("write")
    const second = tracker.start("write")
    expect(tracker.accepts(first)).toBe(false)
    expect(tracker.accepts(second)).toBe(true)
  })

  test("an install reply is accepted beside a load, and an unknown id is not", () => {
    const tracker = requestTracker()
    const load = tracker.start("read")
    const install = tracker.start("install")
    expect(tracker.accepts(load)).toBe(true)
    expect(tracker.accepts(install)).toBe(true)
    expect(tracker.accepts("install:0")).toBe(false)
    expect(tracker.accepts("removed:1")).toBe(false)
    expect(tracker.accepts("")).toBe(false)
  })
})
