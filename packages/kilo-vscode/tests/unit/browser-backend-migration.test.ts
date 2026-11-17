import { describe, expect, test } from "bun:test"
import { migrateBackend } from "../../src/services/browser-automation/backend-migration"
import type { Migration } from "../../src/services/browser-automation/backend-migration"

function setup(overrides: Partial<Migration> & { configValue?: { browser?: unknown } } = {}) {
  const state = {
    migrated: false,
    enabled: true,
    writes: 0,
    marks: 0,
    warnings: 0,
    failWrite: false,
  }
  const input: Migration = {
    migrated: () => state.migrated,
    enabled: () => state.enabled,
    config: async () => overrides.configValue ?? {},
    write: async () => {
      if (state.failWrite) throw new Error("config write failed")
      state.writes += 1
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
    expect(state.writes).toBe(1)
    expect(state.marks).toBe(1)

    expect(await migrateBackend(input)).toBe("skipped")
    expect(state.writes).toBe(1)
  })

  test("leaves the default untouched when the old setting was off", async () => {
    const { input, state } = setup()
    state.enabled = false

    expect(await migrateBackend(input)).toBe("skipped")
    expect(state.writes).toBe(0)
    expect(state.marks).toBe(1)
  })

  test("keeps a browser block the user already configured", async () => {
    const { input, state } = setup({ configValue: { browser: { backend: "off" } } })

    expect(await migrateBackend(input)).toBe("skipped")
    expect(state.writes).toBe(0)
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
    expect(state.writes).toBe(1)
  })
})
