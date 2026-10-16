import { afterEach, describe, expect, test } from "bun:test"

const env = "KILO_VALKEY_GLIDE_PATH"
const prev = process.env[env]

afterEach(() => {
  if (prev === undefined) {
    delete process.env[env]
    return
  }

  process.env[env] = prev
})

describe("resolveGlideSpecifier", () => {
  test("converts the runtime-installed module URL to a path require() accepts", async () => {
    process.env[env] = "file:///tmp/cache/node_modules/@valkey/valkey-glide/build-ts/index.js"
    const { resolveGlideSpecifier } = await import("../../../../src/indexing/vector-store/valkey-loader")

    expect(resolveGlideSpecifier()).toBe("/tmp/cache/node_modules/@valkey/valkey-glide/build-ts/index.js")
  })

  test("falls back to the package name when no override is present", async () => {
    delete process.env[env]
    const { resolveGlideSpecifier } = await import("../../../../src/indexing/vector-store/valkey-loader")

    expect(resolveGlideSpecifier()).toBe("@valkey/valkey-glide")
  })
})

describe("loadGlide", () => {
  test("reports the platform in a not-supported error when the native binding is missing", async () => {
    process.env[env] = "/nonexistent/@valkey/valkey-glide-missing-binding"
    const { loadGlide } = await import("../../../../src/indexing/vector-store/valkey-loader")

    expect(() => loadGlide()).toThrow(
      `The Valkey vector store is not supported on ${process.platform}-${process.arch}. Choose LanceDB or Qdrant instead.`,
    )
  })
})
