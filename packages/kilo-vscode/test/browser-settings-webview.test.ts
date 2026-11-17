import { describe, expect, test } from "bun:test"
import { origin, parse, sites } from "../webview-ui/src/components/settings/browser-settings"

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

  test("a class without a rule asks", () => {
    const [row] = sites([rule("act:https://example.com", "deny")])
    expect(row).toEqual({ origin: "https://example.com", read: "ask", act: "deny", navigate: "ask" })
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
})
