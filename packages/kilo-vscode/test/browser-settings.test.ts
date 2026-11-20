import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import * as vscode from "vscode"
import { BrowserSettings, BrowserSettingsMigration, documentStore } from "../src/browser-settings"

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

  test("a catch-all rule is the allow-all toggle and stays in the rule list", () => {
    const state = BrowserSettings.read({
      permissions: [{ action: "browser", resource: "*", effect: "allow" }],
    })
    expect(state.allowAll).toBe(true)
    // The panel's table does not list it, but the file's other rules must not be rewritten from a state that lost it.
    expect(state.rules).toEqual([{ action: "browser", resource: "*", effect: "allow" }])
  })

  test("keeps rules the editor does not own and removes the one it does, in document order", () => {
    const state = BrowserSettings.read(document)
    const set = BrowserSettings.apply(state, document, {
      rules: BrowserSettings.withoutRule(state, "act:http://localhost:5173"),
    })
    // Every surviving rule keeps the position the user put it in; only the removed one is gone.
    expect(set.permissions).toEqual([
      { action: "browser", resource: "read:https://example.com", effect: "allow" },
      { action: "browser_click", resource: "*", effect: "deny" },
      { action: "provider.use", resource: "kilo", effect: "allow" },
    ])
  })

  test("an edited cell keeps its rule at the same position", () => {
    const state = BrowserSettings.read(document)
    const rules = BrowserSettings.withRule(state, "read:https://example.com", "deny")
    expect(rules).toEqual([
      { action: "browser", resource: "read:https://example.com", effect: "deny" },
      { action: "browser", resource: "act:http://localhost:5173", effect: "ask" },
    ])
    // A new rule is appended, so it wins over the earlier rules the way a fresh edit should.
    expect(BrowserSettings.withRule(state, "navigate:https://kilo.ai", "allow").at(-1)).toEqual({
      action: "browser",
      resource: "navigate:https://kilo.ai",
      effect: "allow",
    })
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

  test("allow-all is one catch-all rule beside the listed origins, ahead of them", () => {
    const state = BrowserSettings.read(document)
    const set = BrowserSettings.apply(state, document, { allowAll: true }).permissions ?? []
    expect(set).toContainEqual({ action: "browser", resource: "*", effect: "allow" })
    expect(set).toContainEqual({ action: "browser", resource: "read:https://example.com", effect: "allow" })
    // Last-match-wins: the catch-all is a baseline, so the specific origin rules after it still decide.
    expect(set.findIndex((rule) => rule.action === "browser" && rule.resource === "*")).toBeLessThan(
      set.findIndex((rule) => rule.action === "browser" && rule.resource === "read:https://example.com"),
    )
    expect(BrowserSettings.apply(state, document, { allowAll: false }).permissions).not.toContainEqual({
      action: "browser",
      resource: "*",
      effect: "allow",
    })
  })

  test("a catch-all rule the user wrote keeps its effect and position", () => {
    const custom = {
      permissions: [
        { action: "browser", resource: "*", effect: "deny" },
        { action: "browser", resource: "read:https://kilo.ai", effect: "allow" },
      ],
    }
    const state = BrowserSettings.read(custom)
    expect(state.allowAll).toBe(false)
    expect(state.rules[0]).toEqual({ action: "browser", resource: "*", effect: "deny" })
    // A cell edit goes through the state, which carries the catch-all, so the deny survives the write.
    const set = BrowserSettings.apply(state, custom, {
      rules: BrowserSettings.withRule(state, "read:https://kilo.ai", "ask"),
    })
    expect(set.permissions).toEqual([
      { action: "browser", resource: "*", effect: "deny" },
      { action: "browser", resource: "read:https://kilo.ai", effect: "ask" },
    ])
    // Turning allow-all on adds its own rule; the hand-written deny is not deleted or moved.
    expect(BrowserSettings.apply(state, custom, { allowAll: true }).permissions).toEqual([
      { action: "browser", resource: "*", effect: "deny" },
      { action: "browser", resource: "*", effect: "allow" },
      { action: "browser", resource: "read:https://kilo.ai", effect: "allow" },
    ])
  })

  test("turning allow-all off removes only its own rule", () => {
    const custom = {
      permissions: [
        { action: "browser", resource: "*", effect: "deny" },
        { action: "browser", resource: "*", effect: "allow" },
        { action: "browser", resource: "act:https://kilo.ai", effect: "deny" },
      ],
    }
    const state = BrowserSettings.read(custom)
    expect(state.allowAll).toBe(true)
    expect(BrowserSettings.apply(state, custom, { allowAll: false }).permissions).toEqual([
      { action: "browser", resource: "*", effect: "deny" },
      { action: "browser", resource: "act:https://kilo.ai", effect: "deny" },
    ])
  })

  test("a patch writes only the keys it names", () => {
    const state = BrowserSettings.read(document)
    // The RPC writes each leaf of `set`, so a key left out here is never written: picking a backend must not also
    // write the observation and sensitive-step defaults the user never chose.
    expect(BrowserSettings.apply(state, document, { browser: { backend: "playwright" } })).toEqual({
      browser: { backend: "playwright" },
    })
    expect(BrowserSettings.apply(state, document, { browser: { observation: "none" } })).toEqual({
      browser: { observation: "none" },
    })
    expect(BrowserSettings.apply(state, document, {})).toEqual({})
    expect(Object.keys(BrowserSettings.apply(state, document, { allowAll: true }))).toEqual(["permissions"])
  })

  test("the state after a write is the file's keys with the patch on top", () => {
    const set = BrowserSettings.apply(BrowserSettings.read({}), {}, { browser: { backend: "extension" } })
    expect(BrowserSettings.read(BrowserSettings.applied({ browser: { headless: true } }, set))).toEqual({
      backend: "extension",
      observation: "diff",
      allow_sensitive: false,
      headless: true,
      rules: [],
      allowAll: false,
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
        write: async (browser) => {
          written.push(browser)
          return Object.keys(browser)
        },
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
      write: async () => {
        writes += 1
        return []
      },
      state: { get: <T>() => true as T, update: async () => {} },
    })
    expect(result.migrated).toBe(false)
    expect(writes).toBe(0)
  })

  test("only fills browser keys the user left unset", () => {
    expect(
      BrowserSettingsMigration.fill({ browser: { backend: "extension" } }, { backend: "playwright", headless: true }),
    ).toEqual({ headless: true })
    expect(
      BrowserSettingsMigration.fill({ browser: { headless: false } }, { backend: "playwright", headless: true }),
    ).toEqual({ backend: "playwright" })
    // Every key already set: the migration writes nothing, but still clears the legacy settings.
    expect(
      BrowserSettingsMigration.fill(
        { browser: { backend: "off", headless: false } },
        { backend: "playwright", headless: true },
      ),
    ).toEqual({})
    // A `null` is the settings RPC's removal marker, so the key counts as unset.
    expect(BrowserSettingsMigration.fill({ browser: { backend: null } }, { backend: "playwright" })).toEqual({
      backend: "playwright",
    })
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

  test("adding a localhost origin keeps the allow the CLI applies by default", () => {
    const state = BrowserSettings.read({})
    expect(
      BrowserSettings.addOrigin(state, "http://localhost:5173").map((rule) => `${rule.resource}=${rule.effect}`),
    ).toEqual([
      "read:http://localhost:5173=allow",
      "act:http://localhost:5173=allow",
      "navigate:http://localhost:5173=allow",
    ])
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

describe("config document writes", () => {
  /** A config file with the RPC's revision guard: a write whose expected revision is stale is refused. */
  function guarded(initial: Record<string, unknown> = {}) {
    let text = JSON.stringify(initial)
    const revision = () => createHash("sha256").update(text).digest("hex")
    return {
      read: async () => ({ path: "/kilo2.json", revision: revision(), document: JSON.parse(text) as unknown }),
      write: async (set: unknown, expected?: { path: string; revision: string }) => {
        if (expected && expected.revision !== revision()) throw new Error("revision-conflict")
        text = JSON.stringify(leaves(JSON.parse(text), set))
      },
      document: () => JSON.parse(text) as Record<string, unknown>,
      writes: 0,
    }
  }

  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)
  /** The RPC's `set` (`kilo-plugin/src/settings.ts` `expandSet`): objects are written leaf by leaf, other values replace. */
  const leaves = (current: unknown, set: unknown): unknown =>
    record(current) && record(set)
      ? { ...current, ...Object.fromEntries(Object.entries(set).map(([key, value]) => [key, leaves(current[key], value)])) }
      : set

  test("two concurrent writes both land instead of one failing on the other's revision", async () => {
    const file = guarded({ browser: { backend: "off", observation: "diff" }, permissions: [] })
    // Count the writes so the test also proves the second one re-read the revision the first one left.
    const write = file.write
    file.write = async (set, expected) => {
      file.writes += 1
      return write(set, expected)
    }
    const store = documentStore(async () => file)
    const [first, second] = await Promise.all([
      store.write({ browser: { backend: "playwright" } }),
      store.write({ browser: { observation: "full" } }),
    ])
    expect(file.writes).toBe(2)
    // Each write names one key, so the file gains exactly those two and no default the user never chose.
    expect(file.document().browser).toEqual({ backend: "playwright", observation: "full" })
    expect(first.backend).toBe("playwright")
    expect(second.observation).toBe("full")
  })

  test("two concurrent site edits keep both origins", async () => {
    const file = guarded({ permissions: [] })
    const store = documentStore(async () => file)
    await Promise.all([
      store.update(({ state }) => ({ rules: BrowserSettings.addOrigin(state, "https://one.test") })),
      store.update(({ state }) => ({ rules: BrowserSettings.addOrigin(state, "https://two.test") })),
    ])
    const resources = (file.document().permissions as { resource: string }[]).map((rule) => rule.resource)
    expect(resources).toContain("read:https://one.test")
    expect(resources).toContain("read:https://two.test")
  })

  test("a rejected write does not block the next one in the queue", async () => {
    const file = guarded({ browser: { backend: "off" }, permissions: [] })
    const write = file.write
    file.write = async (set, expected) => {
      // The first write of the batch fails; the queue must still run the second.
      file.writes += 1
      if (file.writes === 1) throw new Error("rpc unavailable")
      return write(set, expected)
    }
    const store = documentStore(async () => file)
    const [failed, written] = await Promise.all([
      store.write({ browser: { backend: "playwright" } }).then(
        () => false,
        () => true,
      ),
      store.write({ browser: { observation: "none" } }),
    ])
    expect(failed).toBe(true)
    expect(written.observation).toBe("none")
    expect(file.document().browser).toEqual({ backend: "off", observation: "none" })
  })
})
