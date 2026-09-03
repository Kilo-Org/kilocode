import { describe, expect, it } from "bun:test"
import { SandboxPreference } from "../../src/services/sandbox-preference"

function store(initial?: boolean) {
  const values = new Map<string, unknown>()
  if (initial !== undefined) values.set("kilo.sandbox.newSessionDefault", initial)
  return {
    get<T>(key: string, fallback?: T) {
      return (values.has(key) ? values.get(key) : fallback) as T | undefined
    },
    async update(key: string, value: unknown) {
      values.set(key, value)
    },
  }
}

describe("SandboxPreference", () => {
  it("falls back to config until the user selects a default", () => {
    const preference = new SandboxPreference(store())
    expect(preference.resolve(true)).toBe(true)
    expect(preference.resolve(false)).toBe(false)
  })

  it("persists explicit enabled and disabled defaults", async () => {
    const state = store()
    const first = new SandboxPreference(state)
    await first.set(true)
    expect(new SandboxPreference(state).resolve(false)).toBe(true)
    await first.set(false)
    expect(new SandboxPreference(state).resolve(true)).toBe(false)
  })

  it("keeps the prior value when persistence fails", async () => {
    const state = store(true)
    const preference = new SandboxPreference({
      get: state.get,
      update: async () => {
        throw new Error("storage unavailable")
      },
    })
    await expect(preference.set(false)).rejects.toThrow("storage unavailable")
    await Promise.resolve()
    expect(preference.resolve(false)).toBe(true)
  })

  it("serializes validation and updates in user intent order", async () => {
    const preference = new SandboxPreference(store())
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const firstUpdate = preference.set(true, () => first.promise)
    const secondUpdate = preference.set(false, () => second.promise)

    second.resolve()
    await Promise.resolve()
    expect(preference.explicit()).toBeUndefined()
    first.resolve()
    await Promise.all([firstUpdate, secondUpdate])
    expect(preference.resolve(true)).toBe(false)
  })

  it("serializes updates and broadcasts revisions", async () => {
    const preference = new SandboxPreference(store())
    const events: Array<{ enabled: boolean; revision: number }> = []
    preference.onChange((enabled, revision) => events.push({ enabled, revision }))
    await Promise.all([preference.set(true), preference.set(false)])
    expect(preference.resolve(true)).toBe(false)
    expect(events).toEqual([
      { enabled: true, revision: 1 },
      { enabled: false, revision: 2 },
    ])
  })
})
