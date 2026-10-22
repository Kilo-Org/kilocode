import { describe, expect, it } from "bun:test"
import { IndexingConsentStore } from "../../src/indexing-consent"

describe("IndexingConsentStore", () => {
  it("isolates consent by canonical project id", async () => {
    let value: unknown
    const store = new IndexingConsentStore(
      {
        read: () => value,
        write: (next) => {
          value = next
        },
      },
      async (dir) => (dir.includes("alias") ? "/repo/a" : dir),
    )
    const first = await store.project("/repo/a")
    const alias = await store.project("/alias/a")
    const second = await store.project("/repo/b")

    await store.set(first.id, true)

    expect(alias.id).toBe(first.id)
    expect(store.enabled(alias.id)).toBe(true)
    expect(store.enabled(second.id)).toBe(false)
  })

  it("serializes concurrent updates without dropping another project", async () => {
    let value: unknown
    const store = new IndexingConsentStore(
      {
        read: () => value,
        write: async (next) => {
          await Promise.resolve()
          value = next
        },
      },
      async (dir) => dir,
    )
    const first = await store.project("/repo/a")
    const second = await store.project("/repo/b")

    await Promise.all([store.set(first.id, true), store.set(second.id, true)])

    expect(store.enabled(first.id)).toBe(true)
    expect(store.enabled(second.id)).toBe(true)
  })
})
