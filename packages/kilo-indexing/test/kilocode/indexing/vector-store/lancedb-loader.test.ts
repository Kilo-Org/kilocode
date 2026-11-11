import { afterEach, describe, expect, test } from "bun:test"

const env = "KILO_LANCEDB_PATH"
const prev = process.env[env]

afterEach(() => {
  if (prev === undefined) {
    delete process.env[env]
    return
  }

  process.env[env] = prev
})

describe("resolveLanceDBSpecifier", () => {
  test("prefers the explicit runtime-installed module URL", async () => {
    process.env[env] = "file:///tmp/cache/node_modules/@lancedb/lancedb/dist/index.js"
    const { resolveLanceDBSpecifier } = await import("../../../../src/indexing/vector-store/lancedb-loader")

    expect(resolveLanceDBSpecifier()).toBe(process.env[env])
  })

  test("falls back to the package name when no override is present", async () => {
    delete process.env[env]
    const { resolveLanceDBSpecifier } = await import("../../../../src/indexing/vector-store/lancedb-loader")

    expect(resolveLanceDBSpecifier()).toBe("@lancedb/lancedb")
  })
})
