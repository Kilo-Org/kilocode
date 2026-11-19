import { describe, expect, test } from "bun:test"
import type { Permission } from "@opencode/core/permission"
import { BrowserPermission } from "../../src/browser/permission"
import { evaluate } from "../../src/browser/tools"

// The agent's own default ruleset: everything is allowed unless a rule says otherwise, so the browser defaults in
// `evaluate` are what turn an unexpected origin into an ask.
const defaults: Permission.Ruleset = [{ action: "*", resource: "*", effect: "allow" }]

const rule = (action: string, resource: string, effect: "allow" | "ask" | "deny"): Permission.Rule => ({
  action,
  resource,
  effect,
})

const browser = (resource: string, rules: Permission.Ruleset = defaults, allowSensitive = false) =>
  evaluate({ action: "browser", effect: "allow", resources: [resource], rules, allowSensitive }).effect

describe("browser permission defaults", () => {
  test("every class asks on a public origin", () => {
    expect(browser("read:https://example.com")).toBe("ask")
    expect(browser("act:https://example.com")).toBe("ask")
    expect(browser("navigate:https://www.google.com")).toBe("ask")
  })

  test("every class is allowed on the localhost family", () => {
    expect(browser("read:http://localhost:3000")).toBe("allow")
    expect(browser("act:http://127.0.0.1:5173")).toBe("allow")
    expect(browser("navigate:http://app.localhost:8080")).toBe("allow")
    expect(browser("read:https://localhost:8443")).toBe("allow")
  })

  test("an origin without a port still matches the localhost family", () => {
    expect(browser("read:http://localhost")).toBe("allow")
    expect(browser("read:https://localhost")).toBe("allow")
  })

  test("a lookalike host is not the localhost family", () => {
    expect(browser("read:http://localhost.example.com:3000")).toBe("ask")
    expect(browser("read:http://notlocalhost:3000")).toBe("ask")
  })

  test("a saved allow rule wins over the default ask", () => {
    const rules = [...defaults, rule("browser", "read:https://example.com", "allow")]
    expect(browser("read:https://example.com", rules)).toBe("allow")
    expect(browser("act:https://example.com", rules)).toBe("ask")
  })

  test("an explicit rule decides, so the built-in default stays out of its way (D18)", () => {
    const allowed = [...defaults, rule("browser", "act:http://localhost:3000", "allow")]
    expect(browser("act:http://localhost:3000", allowed)).toBe("allow")
    // Core evaluation turns the same rule into `ask`; the hook must not relax it back to the localhost default.
    expect(
      evaluate({
        action: "browser",
        effect: "ask",
        resources: ["act:http://localhost:3000"],
        rules: allowed,
        allowSensitive: false,
      }).effect,
    ).toBe("ask")
  })

  test("allow all is one rule that covers every class and origin", () => {
    const rules = [...defaults, rule("browser", "*", "allow")]
    expect(browser("read:https://example.com", rules)).toBe("allow")
    expect(browser("act:https://example.com", rules)).toBe("allow")
  })

  test("a deny is never relaxed", () => {
    expect(
      evaluate({
        action: "browser",
        effect: "deny",
        resources: ["read:http://localhost:3000"],
        rules: defaults,
        allowSensitive: false,
      }).effect,
    ).toBe("deny")
  })
})

describe("sensitive browser steps", () => {
  const sensitive = (allowSensitive: boolean, rules: Permission.Ruleset = defaults) =>
    evaluate({
      action: "browser_sensitive",
      effect: "allow",
      resources: ["https://example.com"],
      rules,
      allowSensitive,
    })

  test("need a person unless browser.allow_sensitive is on", () => {
    expect(sensitive(false)).toMatchObject({
      effect: "ask",
      message: expect.stringContaining("sensitive browser step"),
    })
    expect(sensitive(true).effect).toBe("allow")
  })

  test("a rule alone does not approve one", () => {
    const rules = [...defaults, rule("browser_sensitive", "*", "allow")]
    expect(sensitive(false, rules).effect).toBe("ask")
    expect(sensitive(true, rules).effect).toBe("allow")
  })

  test("a deny stays a deny", () => {
    expect(
      evaluate({
        action: "browser_sensitive",
        effect: "deny",
        resources: ["https://example.com"],
        rules: defaults,
        allowSensitive: true,
      }).effect,
    ).toBe("deny")
  })
})

describe("browser permission patterns", () => {
  test("an item becomes <class>:<origin>", () => {
    expect(BrowserPermission.pattern({ class: "read", origin: "https://example.com" })).toBe("read:https://example.com")
  })

  test("a saved pattern parses back into the item it came from", () => {
    expect(BrowserPermission.parse("act:http://localhost:3000")).toEqual({
      class: "act",
      origin: "http://localhost:3000",
    })
  })

  test("anything that is not a class and an http(s) origin is rejected", () => {
    expect(BrowserPermission.parse("read")).toBeUndefined()
    expect(BrowserPermission.parse("write:https://example.com")).toBeUndefined()
    expect(BrowserPermission.parse("read:file:///etc/passwd")).toBeUndefined()
    // A string `URL` rejects is not a grant: there is no origin to save.
    expect(BrowserPermission.parse("read:https://exa mple.com")).toBeUndefined()
    expect(BrowserPermission.parse("act:http://")).toBeUndefined()
  })

  test("origins keep the port and drop the path", () => {
    expect(BrowserPermission.origin("https://example.com/a/b?c=d#e")).toBe("https://example.com")
    expect(BrowserPermission.origin("http://localhost:3000/x")).toBe("http://localhost:3000")
    expect(BrowserPermission.origin("about:blank")).toBeUndefined()
  })

  test("an origin-less document still has a site a decision can bind to", () => {
    expect(BrowserPermission.site("https://shop.example.com/a")).toBe("https://shop.example.com")
    expect(BrowserPermission.site("about:blank")).toBe("about:blank")
    expect(BrowserPermission.site("data:text/html,<p>hi</p>")).toBe("data:")
    expect(BrowserPermission.site("blob:https://shop.example.com/1b2c")).toBe("https://shop.example.com")
    expect(BrowserPermission.site("")).toBeUndefined()
  })

  test("classes follow the tool: evaluate needs act (D11)", () => {
    expect(BrowserPermission.classOf("browser_evaluate")).toBe("act")
    expect(BrowserPermission.classOf("browser_click")).toBe("act")
    expect(BrowserPermission.classOf("browser_snapshot")).toBe("read")
    expect(BrowserPermission.classOf("browser_navigate")).toBe("navigate")
    expect(BrowserPermission.classOf("browser_unknown_tool")).toBe("act")
  })
})

describe("browser permission requests", () => {
  test("a class item asks for its pattern and can be saved", () => {
    const request = BrowserPermission.request({ class: "read", origin: "https://example.com" }, false)
    expect(request.action).toBe("browser")
    expect(request.resources).toEqual(["read:https://example.com"])
    expect(request.save).toEqual(["read:https://example.com"])
    expect(request.metadata.rules).toEqual(["read:https://example.com"])
  })

  test("a frame item is marked in the metadata", () => {
    const request = BrowserPermission.request({ class: "act", origin: "https://shop.example.com", frame: true }, false)
    expect(request.metadata).toMatchObject({ frame: true })
  })

  test("a sensitive step asks browser_sensitive, saves no rule and needs a person", () => {
    const request = BrowserPermission.request(
      { class: "sensitive", origin: "https://example.com", reason: "password field" },
      false,
    )
    expect(request.action).toBe("browser_sensitive")
    expect(request.save).toEqual([])
    expect(request.metadata.browserSensitive).toBe(true)
    expect(request.metadata.interactive).toBe(true)
    expect(request.metadata.reason).toBe("password field")
  })

  test("browser.allow_sensitive makes a sensitive step an ordinary ask", () => {
    const request = BrowserPermission.request({ class: "sensitive", origin: "https://example.com" }, true)
    expect(request.action).toBe("browser_sensitive")
    expect(request.metadata.browserSensitive).toBe(false)
  })

  test("items that differ only by the frame flag collapse, and the frame grant wins", () => {
    const unique = BrowserPermission.unique([
      { class: "read", origin: "https://example.com" },
      { class: "read", origin: "https://example.com", frame: true },
      { class: "act", origin: "https://example.com" },
    ])
    expect(unique).toEqual([
      { class: "read", origin: "https://example.com", frame: true },
      { class: "act", origin: "https://example.com" },
    ])
  })
})

describe("browser tool-level permissions", () => {
  const tool = (name: string, rules: Permission.Ruleset = defaults) =>
    evaluate({ action: name, effect: "allow", resources: ["*"], rules, allowSensitive: false }).effect

  test("every browser tool is allowed by default", () => {
    expect(tool("browser_click")).toBe("allow")
    expect(tool("browser_take_screenshot")).toBe("allow")
    expect(tool("browser_navigate")).toBe("allow")
  })

  test("a deny for one tool leaves the rest alone", () => {
    const rules = [...defaults, rule("browser_click", "*", "deny")]
    expect(
      evaluate({ action: "browser_click", effect: "deny", resources: ["*"], rules, allowSensitive: false }).effect,
    ).toBe("deny")
    expect(
      evaluate({ action: "browser_navigate", effect: "allow", resources: ["*"], rules, allowSensitive: false }).effect,
    ).toBe("allow")
  })
})
