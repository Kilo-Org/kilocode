import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

const entry = "file:///tmp/kilo-cache/node_modules/@lancedb/lancedb/dist/index.js"
const add = mock(async () => ({ directory: "/tmp/kilo-cache", entrypoint: entry }))
const real = await import("../../src/npm/index")

mock.module("../../src/npm/index", () => ({
  ...real,
  Npm: {
    ...real.Npm,
    add,
  },
}))

const env = "KILO_LANCEDB_PATH"
const prev = process.env[env]

describe("LanceDBRuntime", () => {
  beforeEach(async () => {
    const { LanceDBRuntime } = await import("../../src/kilocode/lancedb")
    LanceDBRuntime.clear()
    add.mockClear()
    add.mockImplementation(async () => ({ directory: "/tmp/kilo-cache", entrypoint: entry }))
  })

  afterEach(async () => {
    const { LanceDBRuntime } = await import("../../src/kilocode/lancedb")
    LanceDBRuntime.clear()
    if (prev === undefined) delete process.env[env]
    if (prev !== undefined) process.env[env] = prev
  })

  test("skips installation for non-lancedb backends", async () => {
    const { LanceDBRuntime } = await import("../../src/kilocode/lancedb")

    await LanceDBRuntime.ensure("qdrant")

    expect(add).not.toHaveBeenCalled()
    expect(process.env[env]).toBeUndefined()
  })

  test("installs the pinned package and exports a file URL for lancedb", async () => {
    const { LanceDBRuntime } = await import("../../src/kilocode/lancedb")

    await LanceDBRuntime.ensure("lancedb")

    expect(add).toHaveBeenCalledWith("@lancedb/lancedb@0.26.2")
    expect(process.env[env]).toBe(entry)
  })

  test("exposes every LanceDB package that must stay external to bun compile", async () => {
    const { LanceDBRuntime } = await import("../../src/kilocode/lancedb")

    expect(LanceDBRuntime.external).toEqual([
      "@lancedb/lancedb",
      "@lancedb/lancedb-darwin-arm64",
      "@lancedb/lancedb-linux-arm64-gnu",
      "@lancedb/lancedb-linux-arm64-musl",
      "@lancedb/lancedb-linux-x64-gnu",
      "@lancedb/lancedb-linux-x64-musl",
      "@lancedb/lancedb-win32-arm64-msvc",
      "@lancedb/lancedb-win32-x64-msvc",
    ])
  })

  test("skips install when runtime path is already set", async () => {
    const { LanceDBRuntime } = await import("../../src/kilocode/lancedb")
    process.env[env] = "file:///already/set.js"

    await LanceDBRuntime.ensure("lancedb")

    expect(add).not.toHaveBeenCalled()
    expect(process.env[env]).toBe("file:///already/set.js")
  })

  test("dedupes concurrent ensure calls", async () => {
    const { LanceDBRuntime } = await import("../../src/kilocode/lancedb")

    await Promise.all([
      LanceDBRuntime.ensure("lancedb"),
      LanceDBRuntime.ensure("lancedb"),
      LanceDBRuntime.ensure("lancedb"),
    ])

    expect(add).toHaveBeenCalledTimes(1)
    expect(process.env[env]).toBe(entry)
  })

  test("surfaces install failures without swallowing them", async () => {
    const { LanceDBRuntime } = await import("../../src/kilocode/lancedb")
    add.mockImplementationOnce(async () => {
      throw new Error("registry unavailable")
    })

    await expect(LanceDBRuntime.ensure("lancedb")).rejects.toThrow("registry unavailable")
    expect(process.env[env]).toBeUndefined()
  })

  test("retries after a failed install", async () => {
    const { LanceDBRuntime } = await import("../../src/kilocode/lancedb")
    add
      .mockImplementationOnce(async () => {
        throw new Error("install failed")
      })
      .mockImplementationOnce(async () => ({ directory: "/tmp/kilo-cache", entrypoint: entry }))

    await expect(LanceDBRuntime.ensure("lancedb")).rejects.toThrow("install failed")
    expect(process.env[env]).toBeUndefined()
    expect(add).toHaveBeenCalledTimes(1)

    await LanceDBRuntime.ensure("lancedb")

    expect(add).toHaveBeenCalledTimes(2)
    expect(process.env[env]).toBe(entry)
  })
})
