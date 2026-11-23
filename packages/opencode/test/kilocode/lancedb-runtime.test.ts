import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"

const entry = "file:///tmp/kilo-cache/node_modules/@lancedb/lancedb/dist/index.js"
const add = mock(async () => ({ directory: "/tmp/kilo-cache", entrypoint: entry }))
const real = await import("@opencode-ai/core/npm")

mock.module("@opencode-ai/core/npm", () => ({
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

  test("guides Intel Mac users to Qdrant", async () => {
    const { LanceDBRuntime } = await import("../../src/kilocode/lancedb")
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!
    const arch = Object.getOwnPropertyDescriptor(process, "arch")!
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" })
    Object.defineProperty(process, "arch", { ...arch, value: "x64" })

    try {
      await expect(LanceDBRuntime.ensure("lancedb")).rejects.toThrow(
        'LanceDB is not supported on Intel Macs. Set "indexing.vectorStore" to "qdrant" and configure a Qdrant server.',
      )
      expect(add).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, "platform", platform)
      Object.defineProperty(process, "arch", arch)
    }
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

  test("reads build metadata without initializing runtime directories", async () => {
    await using tmp = await tmpdir()
    const blocked = path.join(tmp.path, "blocked")
    await Bun.write(blocked, "not a directory")

    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        'const { LanceDBRuntime } = await import("./src/kilocode/lancedb"); console.log(LanceDBRuntime.external[0])',
      ],
      {
        cwd: path.resolve(import.meta.dir, "../.."),
        env: {
          ...process.env,
          XDG_DATA_HOME: blocked,
          XDG_CACHE_HOME: blocked,
          XDG_CONFIG_HOME: blocked,
          XDG_STATE_HOME: blocked,
        },
        windowsHide: true,
      },
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString().trim()).toBe("@lancedb/lancedb")
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
