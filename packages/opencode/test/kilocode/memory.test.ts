import { afterEach, describe, expect, test } from "bun:test"
import { Memory } from "../../src/kilocode/memory"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

describe("kilocode.memory", () => {
  test("stores memory per project and survives instance reload", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Memory.set({ key: "build", content: "Run bun test from packages/opencode" })
      },
    })

    await Instance.disposeAll()

    const items = await Instance.provide({
      directory: tmp.path,
      fn: async () => Memory.list(),
    })

    expect(items).toHaveLength(1)
    expect(items[0]?.key).toBe("build")
    expect(items[0]?.content).toBe("Run bun test from packages/opencode")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Memory.remove({ key: "build" })
      },
    })
  })

  test("isolates memory by project", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    await Instance.provide({
      directory: first.path,
      fn: async () => {
        await Memory.set({ key: "build", content: "first project" })
      },
    })

    const items = await Instance.provide({
      directory: second.path,
      fn: async () => Memory.list(),
    })

    expect(items).toEqual([])

    await Instance.provide({
      directory: first.path,
      fn: async () => {
        await Memory.remove({ key: "build" })
      },
    })
  })
})
