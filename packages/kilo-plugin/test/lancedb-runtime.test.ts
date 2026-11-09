import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Npm } from "@opencode/util/npm"
import { Effect } from "effect"
import { ensure, env } from "../src/indexing/lancedb"

const previous = process.env[env]
const installed: string[] = []
const dirs: string[] = []

afterEach(async () => {
  installed.length = 0
  if (previous === undefined) delete process.env[env]
  if (previous !== undefined) process.env[env] = previous
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5 })))
})

// An npm installer that records the request and lays out a package with a `main` entry.
const npm = (fail?: Error) =>
  ({
    add: (pkg: string) =>
      Effect.promise(async () => {
        installed.push(pkg)
        if (fail) throw fail
        const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-lancedb-"))
        dirs.push(directory)
        await Bun.write(path.join(directory, "package.json"), JSON.stringify({ main: "dist/index.js" }))
        return { directory, name: "@lancedb/lancedb" }
      }),
  }) as unknown as Npm.Interface

const run = (store: string | undefined, installer?: Npm.Interface, bundled = () => false) =>
  Effect.runPromise(ensure(store, installer, bundled))

describe("LanceDBRuntime", () => {
  test("skips installation for non-lancedb backends", async () => {
    delete process.env[env]
    await run("qdrant", npm())
    expect(installed).toEqual([])
    expect(process.env[env]).toBeUndefined()
  })

  test("guides Intel Mac users to Qdrant", async () => {
    delete process.env[env]
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!
    const arch = Object.getOwnPropertyDescriptor(process, "arch")!
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" })
    Object.defineProperty(process, "arch", { ...arch, value: "x64" })
    try {
      const error = await run("lancedb", npm()).catch((err) => err)
      expect(String(error)).toContain(
        'LanceDB is not supported on Intel Macs. Set "indexing.vectorStore" to "qdrant" and configure a Qdrant server.',
      )
      expect(installed).toEqual([])
    } finally {
      Object.defineProperty(process, "platform", platform)
      Object.defineProperty(process, "arch", arch)
    }
  })

  test("installs the pinned package and exports its entry for lancedb", async () => {
    delete process.env[env]
    await run("lancedb", npm())
    expect(installed).toEqual(["@lancedb/lancedb@0.26.2"])
    expect(process.env[env]).toBe(path.join(dirs[0]!, "dist/index.js"))
  })

  test("uses the engine's own dependency when it resolves, as in a source checkout", async () => {
    delete process.env[env]
    await run("lancedb", npm(), () => true)
    expect(installed).toEqual([])
    expect(process.env[env]).toBeUndefined()
  })

  test("skips install when the runtime path is already set", async () => {
    process.env[env] = "/already/set.js"
    await run("lancedb", npm())
    expect(installed).toEqual([])
    expect(process.env[env]).toBe("/already/set.js")
  })

  test("dedupes concurrent ensure calls", async () => {
    delete process.env[env]
    const installer = npm()
    await Promise.all([run("lancedb", installer), run("lancedb", installer), run("lancedb", installer)])
    expect(installed).toEqual(["@lancedb/lancedb@0.26.2"])
    expect(process.env[env]).toBeDefined()
  })

  test("surfaces install failures and retries on the next call", async () => {
    delete process.env[env]
    const error = await run("lancedb", npm(new Error("registry unavailable"))).catch((err) => err)
    expect(String(error)).toContain("registry unavailable")
    expect(process.env[env]).toBeUndefined()
    await run("lancedb", npm())
    expect(installed).toEqual(["@lancedb/lancedb@0.26.2", "@lancedb/lancedb@0.26.2"])
    expect(process.env[env]).toBeDefined()
  })
})
