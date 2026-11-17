import { describe, expect, test } from "bun:test"
import { Permission } from "@/permission"
import { BrowserPermission } from "@/kilocode/browser/permission"

// The built-in defaults: the localhost family is allowed, every other origin asks.
const defaults = Permission.fromConfig(BrowserPermission.defaults())

const action = (pattern: string, ...extra: Permission.Ruleset[]) =>
  Permission.evaluate("browser", pattern, defaults, ...extra).action

describe("browser permission defaults", () => {
  test("every class asks on a public origin", () => {
    expect(action("read:https://example.com")).toBe("ask")
    expect(action("act:https://example.com")).toBe("ask")
    expect(action("navigate:https://www.google.com")).toBe("ask")
  })

  test("every class is allowed on the localhost family", () => {
    expect(action("read:http://localhost:3000")).toBe("allow")
    expect(action("act:http://127.0.0.1:5173")).toBe("allow")
    expect(action("navigate:http://app.localhost:8080")).toBe("allow")
    expect(action("read:https://localhost:8443")).toBe("allow")
  })

  test("an origin without a port still matches the localhost family", () => {
    expect(action("read:http://localhost")).toBe("allow")
    expect(action("read:https://localhost")).toBe("allow")
  })

  test("a lookalike host is not the localhost family", () => {
    expect(action("read:http://localhost.example.com:3000")).toBe("ask")
    expect(action("read:http://notlocalhost:3000")).toBe("ask")
  })

  test("a saved allow rule from config wins over the default ask", () => {
    const config = Permission.fromConfig({ browser: { "read:https://example.com": "allow" } })
    expect(action("read:https://example.com", config)).toBe("allow")
    expect(action("act:https://example.com", config)).toBe("ask")
  })

  test("a project deny rule wins over the default localhost allow (D18)", () => {
    const config = Permission.fromConfig({ browser: { "act:http://localhost:3000": "deny" } })
    expect(action("act:http://localhost:3000", config)).toBe("deny")
    expect(action("read:http://localhost:3000", config)).toBe("allow")
  })

  test("allow all writes a scalar rule that covers every class and origin", () => {
    const config = Permission.fromConfig({ browser: "allow" })
    expect(action("read:https://example.com", config)).toBe("allow")
    expect(action("act:https://example.com", config)).toBe("allow")
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
  })

  test("origins keep the port and drop the path", () => {
    expect(BrowserPermission.origin("https://example.com/a/b?c=d#e")).toBe("https://example.com")
    expect(BrowserPermission.origin("http://localhost:3000/x")).toBe("http://localhost:3000")
    expect(BrowserPermission.origin("about:blank")).toBeUndefined()
  })

  test("classes follow the tool: evaluate and unsafe code need act (D11)", () => {
    expect(BrowserPermission.classOf("browser_evaluate")).toBe("act")
    expect(BrowserPermission.classOf("browser_run_code_unsafe")).toBe("act")
    expect(BrowserPermission.classOf("browser_click")).toBe("act")
    expect(BrowserPermission.classOf("browser_snapshot")).toBe("read")
    expect(BrowserPermission.classOf("browser_navigate")).toBe("navigate")
    expect(BrowserPermission.classOf("browser_unknown_tool")).toBe("act")
  })
})

describe("browser permission requests", () => {
  test("a class item asks for its pattern and can be saved", () => {
    const request = BrowserPermission.request({ class: "read", origin: "https://example.com" }, false)
    expect(request.permission).toBe("browser")
    expect(request.patterns).toEqual(["read:https://example.com"])
    expect(request.always).toEqual(["read:https://example.com"])
    expect(request.metadata.rules).toEqual(["read:https://example.com"])
  })

  test("a sensitive step asks browser_sensitive and saves no rule", () => {
    const request = BrowserPermission.request(
      { class: "sensitive", origin: "https://example.com", reason: "password field" },
      false,
    )
    expect(request.permission).toBe("browser_sensitive")
    expect(request.always).toEqual([])
    expect(request.metadata.browserSensitive).toBe(true)
    expect(request.metadata.reason).toBe("password field")
  })

  test("browser.allowSensitive makes a sensitive step an ordinary ask", () => {
    const request = BrowserPermission.request(
      { class: "sensitive", origin: "https://example.com", reason: "password field" },
      true,
    )
    expect(request.permission).toBe("browser_sensitive")
    expect(request.metadata.browserSensitive).toBe(false)
  })
})

describe("browser tool-level permissions", () => {
  const tool = (name: string, ...extra: Permission.Ruleset[]) =>
    Permission.evaluate(name, "*", defaults, ...extra).action

  test("every browser tool is allowed by default", () => {
    expect(tool("browser_click")).toBe("allow")
    expect(tool("browser_take_screenshot")).toBe("allow")
    expect(tool("browser_navigate")).toBe("allow")
  })

  test("a tool rule can restrict one tool and leave the rest alone", () => {
    const config = Permission.fromConfig({ browser_click: "ask", browser_type: "deny" })
    expect(tool("browser_click", config)).toBe("ask")
    expect(tool("browser_type", config)).toBe("deny")
    expect(tool("browser_navigate", config)).toBe("allow")
  })
})
