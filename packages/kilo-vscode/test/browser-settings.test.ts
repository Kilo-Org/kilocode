import { describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { BrowserSettings, BrowserSettingsMigration } from "../src/browser-settings"

const document: Record<string, unknown> = {
  browser: { backend: "extension", observation: "diff", allow_sensitive: true, headless: true },
  permissions: [
    { action: "browser", resource: "read:https://example.com", effect: "allow" },
    { action: "browser", resource: "act:http://localhost:5173", effect: "ask" },
    { action: "browser_click", resource: "*", effect: "deny" },
    { action: "provider.use", resource: "kilo", effect: "allow" },
  ],
}

describe("browser settings document", () => {
  test("reads the browser block with its defaults", () => {
    expect(BrowserSettings.read({})).toEqual({
      backend: "playwright",
      observation: "diff",
      allow_sensitive: false,
      rules: [],
      allowAll: false,
    })
    expect(BrowserSettings.read(document)).toMatchObject({
      backend: "extension",
      observation: "diff",
      allow_sensitive: true,
      headless: true,
      allowAll: false,
      rules: [
        { action: "browser", resource: "read:https://example.com", effect: "allow" },
        { action: "browser", resource: "act:http://localhost:5173", effect: "ask" },
      ],
    })
  })

  test("an unknown backend falls back to the default instead of hiding the tools", () => {
    expect(BrowserSettings.read({ browser: { backend: "chrome" } }).backend).toBe("playwright")
  })

  test("a catch-all allow rule is the allow-all toggle, not a list entry", () => {
    const state = BrowserSettings.read({
      permissions: [{ action: "browser", resource: "*", effect: "allow" }],
    })
    expect(state.allowAll).toBe(true)
    expect(state.rules).toEqual([])
  })

  test("keeps rules the editor does not own and removes the one it does", () => {
    const state = BrowserSettings.read(document)
    const set = BrowserSettings.apply(state, document, {
      rules: BrowserSettings.withoutRule(state, "act:http://localhost:5173"),
    })
    // Rules the editor does not own keep their document order; the collected origin rules follow them.
    expect(set.permissions).toEqual([
      { action: "browser_click", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "kilo", effect: "allow" },
      { action: "browser", resource: "read:https://example.com", effect: "allow" },
    ])
  })

  test("adds and replaces one origin rule", () => {
    const state = BrowserSettings.read(document)
    const rules = BrowserSettings.withRule(state, "read:https://example.com", "deny")
    expect(rules.filter((rule) => rule.resource === "read:https://example.com")).toEqual([
      { action: "browser", resource: "read:https://example.com", effect: "deny" },
    ])
    expect(BrowserSettings.withRule(state, "navigate:https://kilo.ai", "allow")).toContainEqual({
      action: "browser",
      resource: "navigate:https://kilo.ai",
      effect: "allow",
    })
  })

  test("allow-all is one catch-all rule beside the listed origins", () => {
    const state = BrowserSettings.read(document)
    const set = BrowserSettings.apply(state, document, { allowAll: true })
    expect(set.permissions).toContainEqual({ action: "browser", resource: "*", effect: "allow" })
    expect(set.permissions).toContainEqual({ action: "browser", resource: "read:https://example.com", effect: "allow" })
    expect(BrowserSettings.apply(state, document, { allowAll: false }).permissions).not.toContainEqual({
      action: "browser",
      resource: "*",
      effect: "allow",
    })
  })

  test("a patch leaves every untouched key in place", () => {
    const state = BrowserSettings.read(document)
    const set = BrowserSettings.apply(state, document, { browser: { observation: "none" } })
    expect(set.browser).toEqual({ backend: "extension", observation: "none", allow_sensitive: true, headless: true })
    expect(BrowserSettings.apply(state, document, {}).browser).toEqual({
      backend: "extension",
      observation: "diff",
      allow_sensitive: true,
      headless: true,
    })
  })

  test("a rule reads as its class and origin", () => {
    expect(BrowserSettings.format({ action: "browser", resource: "read:https://example.com", effect: "ask" })).toBe(
      "read on https://example.com → ask",
    )
    expect(BrowserSettings.format({ action: "browser", resource: "*", effect: "allow" })).toBe("every origin → allow")
    expect(BrowserSettings.format({ action: "browser_click", resource: "*", effect: "deny" })).toBe(
      "browser_click → deny",
    )
  })
})

describe("browser settings migration", () => {
  const config = (values: { enabled?: boolean; headless?: boolean }, cleared: string[]) =>
    ({
      inspect: (key: string) => ({
        globalValue: key === "enabled" ? values.enabled : undefined,
        workspaceValue: key === "headless" ? values.headless : undefined,
      }),
      update: async (key: string) => {
        cleared.push(key)
      },
    }) as unknown as vscode.WorkspaceConfiguration

  test("enabled and headless become the browser keys", () => {
    expect(BrowserSettingsMigration.translate({ enabled: true, headless: true })).toEqual({
      backend: "playwright",
      headless: true,
    })
    // `enabled: false` was the old default, not a decision about the new tools.
    expect(BrowserSettingsMigration.translate({ enabled: false })).toBeUndefined()
    expect(BrowserSettingsMigration.translate({})).toBeUndefined()
  })

  test("runs once, writes the keys and clears the legacy settings", async () => {
    const cleared: string[] = []
    const original = vscode.workspace.getConfiguration
    ;(vscode.workspace as unknown as { getConfiguration: unknown }).getConfiguration = () =>
      config({ enabled: true, headless: false }, cleared)
    try {
      const marked: unknown[] = []
      const written: unknown[] = []
      const result = await BrowserSettingsMigration.run({
        write: async (browser) => void written.push(browser),
        state: { get: <T>() => undefined as T | undefined, update: async (_key, value) => void marked.push(value) },
      })
      expect(result).toEqual({ migrated: true, wrote: ["backend", "headless"] })
      expect(written).toEqual([{ backend: "playwright", headless: false }])
      expect(cleared).toEqual(["enabled", "headless", "useSystemChrome"])
      expect(marked).toEqual([true])
    } finally {
      ;(vscode.workspace as unknown as { getConfiguration: unknown }).getConfiguration = original
    }
  })

  test("a migrated user is never migrated twice", async () => {
    let writes = 0
    const result = await BrowserSettingsMigration.run({
      write: async () => void (writes += 1),
      state: { get: <T>() => true as T, update: async () => {} },
    })
    expect(result.migrated).toBe(false)
    expect(writes).toBe(0)
  })

  test("a failed write keeps the legacy settings so the next start retries", async () => {
    const cleared: string[] = []
    const original = vscode.workspace.getConfiguration
    ;(vscode.workspace as unknown as { getConfiguration: unknown }).getConfiguration = () =>
      config({ enabled: true }, cleared)
    try {
      const marked: unknown[] = []
      const result = await BrowserSettingsMigration.run({
        write: async () => {
          throw new Error("rpc unavailable")
        },
        state: { get: <T>() => undefined as T | undefined, update: async (_key, value) => void marked.push(value) },
      })
      expect(result).toMatchObject({ migrated: false, error: "rpc unavailable" })
      expect(cleared).toEqual([])
      expect(marked).toEqual([])
    } finally {
      ;(vscode.workspace as unknown as { getConfiguration: unknown }).getConfiguration = original
    }
  })
})

describe("site rules", () => {
  test("a resource splits at its first colon", () => {
    expect(BrowserSettings.originOf("act:https://example.com:8443")).toEqual({
      type: "act",
      origin: "https://example.com:8443",
    })
    expect(BrowserSettings.originOf("navigate")).toBeUndefined()
  })

  test("adding a site writes every class it does not have, asking", () => {
    const state = BrowserSettings.read({
      permissions: [{ action: "browser", resource: "read:https://kilo.ai", effect: "allow" }],
    })
    expect(
      BrowserSettings.addOrigin(state, "https://kilo.ai").map((rule) => `${rule.resource}=${rule.effect}`),
    ).toEqual(["read:https://kilo.ai=allow", "act:https://kilo.ai=ask", "navigate:https://kilo.ai=ask"])
  })

  test("removing a site drops every class of it and nothing else", () => {
    const state = BrowserSettings.read({
      permissions: [
        { action: "browser", resource: "read:https://kilo.ai", effect: "allow" },
        { action: "browser", resource: "act:https://kilo.ai", effect: "ask" },
        { action: "browser", resource: "read:https://example.com", effect: "allow" },
        { action: "shell", resource: "*" },
      ],
    })
    expect(BrowserSettings.withoutOrigin(state, "https://kilo.ai")).toEqual([
      { action: "browser", resource: "read:https://example.com", effect: "allow" },
    ])
  })
})
