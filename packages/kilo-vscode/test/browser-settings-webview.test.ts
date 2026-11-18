import { describe, expect, test } from "bun:test"
import { BrowserPermission } from "../../kilo-plugin/src/browser/permission"
import { Wildcard } from "../../core/src/util/wildcard"
import { origin, parse, sites } from "../webview-ui/src/components/settings/browser-settings"
import { defaultAllow } from "../src/shared/browser-permissions"
import { requestTracker } from "../webview-ui/src/v2/browser-settings-requests"

const rule = (resource: string, effect: Effect = "allow"): TestRule => ({
  action: "browser",
  resource,
  effect,
})

type Grant = "read" | "act" | "navigate"
type Effect = "allow" | "ask" | "deny"
type TestRule = { action: string; resource: string; effect: Effect }

/**
 * The CLI's own resolution, assembled from its pieces: a rule decides the class only when its action matches
 * `browser` and its resource matches `<class>:<origin>`, the last such rule wins (`core/src/permission.ts`), and a
 * class no rule decides keeps the plugin's built-in default (`kilo-plugin/src/browser/tools.ts`).
 */
function cli(rules: TestRule[], grant: Grant, origin: string): Effect {
  const resource = `${grant}:${origin}`
  const matched = rules.filter(
    (item) => item.action !== "*" && Wildcard.match("browser", item.action) && Wildcard.match(resource, item.resource),
  )
  if (matched.length === 0) return defaultAllow(origin) ? "allow" : "ask"
  return matched[matched.length - 1]!.effect
}

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

describe("the site table follows the CLI's resolution", () => {
  const cases: { name: string; rules: TestRule[]; expected?: Record<string, Record<Grant, Effect>> }[] = [
    {
      name: "a catch-all written after an origin rule overrides it",
      rules: [rule("read:https://example.com"), rule("act:https://example.com"), rule("*", "deny")],
      expected: { "https://example.com": { read: "deny", act: "deny", navigate: "deny" } },
    },
    {
      name: "an origin rule written after a catch-all still wins",
      rules: [rule("*", "deny"), rule("read:https://example.com", "allow")],
      expected: { "https://example.com": { read: "allow", act: "deny", navigate: "deny" } },
    },
    {
      name: "a class catch-all resolves a later origin rule",
      rules: [rule("read:*", "deny"), rule("read:https://example.com", "allow")],
      expected: { "https://example.com": { read: "allow", act: "ask", navigate: "ask" } },
    },
    {
      name: "a localhost origin keeps the default where no rule names the class",
      rules: [rule("act:http://localhost:3000", "deny")],
      expected: { "http://localhost:3000": { read: "allow", act: "deny", navigate: "allow" } },
    },
    {
      name: "a wildcard host rule resolves the origins it matches",
      rules: [rule("read:http://*.localhost:*", "deny"), rule("read:http://app.localhost", "allow")],
      expected: {
        "http://*.localhost:*": { read: "deny", act: "ask", navigate: "ask" },
        "http://app.localhost": { read: "allow", act: "allow", navigate: "allow" },
      },
    },
  ]

  for (const item of cases) {
    test(item.name, () => {
      const rows = sites(item.rules)
      for (const row of rows) {
        for (const grant of ["read", "act", "navigate"] as const) {
          expect({ origin: row.origin, grant, effect: row[grant] }).toEqual({
            origin: row.origin,
            grant,
            effect: cli(item.rules, grant, row.origin),
          })
        }
      }
      if (item.expected) expect(Object.fromEntries(rows.map((row) => [row.origin, row]))).toMatchObject(item.expected)
    })
  }

  test("a catch-all alone is the toggle, so the table stays empty", () => {
    expect(sites([rule("*", "deny"), rule("*", "allow")])).toEqual([])
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

  test("a port above 65535 is refused, because no origin can use it", () => {
    expect(origin("https://example.com:65536")).toEqual({ error: "invalid" })
    expect(origin("http://localhost:99999")).toEqual({ error: "invalid" })
    expect(origin("http://*.localhost:70000")).toEqual({ error: "invalid" })
    expect(origin("https://example.com:65535")).toEqual({ value: "https://example.com:65535" })
    expect(origin("http://localhost:65535")).toEqual({ value: "http://localhost:65535" })
  })

  test("a leading zero is normalized like the URL parser's port", () => {
    expect(origin("http://localhost:0443")).toEqual({ value: "http://localhost:443" })
    expect(origin("https://example.com:0443")).toEqual({ value: "https://example.com" })
    expect(origin("https://example.com:08443")).toEqual({ value: "https://example.com:8443" })
    expect(origin("http://*.localhost:0999")).toEqual({ error: "invalid" })
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
