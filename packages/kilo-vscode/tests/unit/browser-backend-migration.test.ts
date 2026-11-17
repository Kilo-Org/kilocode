import { describe, expect, test } from "bun:test"
import { migrateBackend } from "../../src/services/browser-automation/backend-migration"
import type { BrowserConfig, Migration } from "../../src/services/browser-automation/backend-migration"

function setup(overrides: Partial<Migration> & { configValue?: { browser?: unknown } } = {}) {
  const state = {
    migrated: false,
    enabled: true,
    headless: false,
    writes: [] as BrowserConfig[],
    marks: 0,
    warnings: 0,
    failWrite: false,
  }
  const input: Migration = {
    migrated: () => state.migrated,
    enabled: () => state.enabled,
    headless: () => state.headless,
    config: async () => overrides.configValue ?? {},
    write: async (config) => {
      if (state.failWrite) throw new Error("config write failed")
      state.writes.push(config)
    },
    mark: async () => {
      state.marks += 1
      state.migrated = true
    },
    warn: () => {
      state.warnings += 1
    },
    ...overrides,
  }
  return { input, state }
}

describe("browser backend migration", () => {
  test("writes browser.backend once when the old Playwright setting was on", async () => {
    const { input, state } = setup()

    expect(await migrateBackend(input)).toBe("written")
    expect(state.writes).toEqual([{ browser: { backend: "playwright" } }])
    expect(state.marks).toBe(1)

    expect(await migrateBackend(input)).toBe("skipped")
    expect(state.writes.length).toBe(1)
  })

  test("writes the old headless choice with the backend", async () => {
    const { input, state } = setup()
    state.headless = true

    expect(await migrateBackend(input)).toBe("written")
    expect(state.writes).toEqual([{ browser: { backend: "playwright", headless: true } }])
  })

  test("keeps a headless choice when automation was off", async () => {
    const { input, state } = setup()
    state.enabled = false
    state.headless = true

    expect(await migrateBackend(input)).toBe("written")
    expect(state.writes).toEqual([{ browser: { headless: true } }])
  })

  test("leaves the default untouched when the old settings were off", async () => {
    const { input, state } = setup()
    state.enabled = false

    expect(await migrateBackend(input)).toBe("skipped")
    expect(state.writes.length).toBe(0)
    expect(state.marks).toBe(1)
  })

  test("keeps a browser block the user already configured", async () => {
    const { input, state } = setup({ configValue: { browser: { backend: "off" } } })

    expect(await migrateBackend(input)).toBe("skipped")
    expect(state.writes.length).toBe(0)
    expect(state.marks).toBe(1)
  })

  test("retries on the next connection when the write fails", async () => {
    const { input, state } = setup()
    state.failWrite = true

    expect(await migrateBackend(input)).toBe("failed")
    expect(state.warnings).toBe(1)
    expect(state.migrated).toBe(false)

    state.failWrite = false
    expect(await migrateBackend(input)).toBe("written")
    expect(state.writes).toEqual([{ browser: { backend: "playwright" } }])
  })

  test("a failing mark is reported and retried instead of escaping", async () => {
    const { input, state } = setup()
    state.enabled = false
    let attempts = 0
    input.mark = async () => {
      attempts += 1
      if (attempts === 1) throw new Error("state write failed")
    }

    expect(await migrateBackend(input)).toBe("failed")
    expect(state.warnings).toBe(1)
    expect(await migrateBackend(input)).toBe("skipped")
    expect(attempts).toBe(2)
  })
})
