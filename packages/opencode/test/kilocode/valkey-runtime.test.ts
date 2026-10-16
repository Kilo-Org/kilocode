import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

const entry = "file:///tmp/kilo-cache/node_modules/@valkey/valkey-glide/build-ts/index.js"
const add = mock(async () => ({ directory: "/tmp/kilo-cache", entrypoint: entry }))
const real = await import("@opencode-ai/core/npm")

mock.module("@opencode-ai/core/npm", () => ({
  ...real,
  Npm: {
    ...real.Npm,
    add,
  },
}))

const env = "KILO_VALKEY_GLIDE_PATH"
const prev = process.env[env]

describe("ValkeyRuntime", () => {
  beforeEach(async () => {
    const { ValkeyRuntime } = await import("../../src/kilocode/valkey")
    ValkeyRuntime.clear()
    add.mockClear()
    add.mockImplementation(async () => ({ directory: "/tmp/kilo-cache", entrypoint: entry }))
  })

  afterEach(async () => {
    const { ValkeyRuntime } = await import("../../src/kilocode/valkey")
    ValkeyRuntime.clear()
    if (prev === undefined) delete process.env[env]
    if (prev !== undefined) process.env[env] = prev
  })

  test("skips installation for non-valkey backends", async () => {
    const { ValkeyRuntime } = await import("../../src/kilocode/valkey")

    await ValkeyRuntime.ensure("lancedb")

    expect(add).not.toHaveBeenCalled()
    expect(process.env[env]).toBeUndefined()
  })

  test("guides Windows users to another backend without installing", async () => {
    const { ValkeyRuntime } = await import("../../src/kilocode/valkey")
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!
    Object.defineProperty(process, "platform", { ...platform, value: "win32" })

    try {
      await expect(ValkeyRuntime.ensure("valkey")).rejects.toThrow(
        'Valkey is not supported on Windows. Set "indexing.vectorStore" to "lancedb" or "qdrant".',
      )
      expect(add).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, "platform", platform)
    }
  })

  test("installs the pinned package once and exports its entrypoint", async () => {
    const { ValkeyRuntime } = await import("../../src/kilocode/valkey")

    await Promise.all([ValkeyRuntime.ensure("valkey"), ValkeyRuntime.ensure("valkey")])

    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith("@valkey/valkey-glide@2.5.2")
    expect(process.env[env]).toBe(entry)
  })

  test("retries after a failed install", async () => {
    const { ValkeyRuntime } = await import("../../src/kilocode/valkey")
    add.mockImplementationOnce(async () => {
      throw new Error("registry unavailable")
    })

    await expect(ValkeyRuntime.ensure("valkey")).rejects.toThrow("registry unavailable")
    expect(process.env[env]).toBeUndefined()

    await ValkeyRuntime.ensure("valkey")

    expect(add).toHaveBeenCalledTimes(2)
    expect(process.env[env]).toBe(entry)
  })
})
