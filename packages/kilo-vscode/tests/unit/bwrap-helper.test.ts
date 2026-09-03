import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { ensureBwrapForTarget } from "../../script/bwrap-helper"
import {
  localBwrapPath,
  resolveLocalBwrapEnv,
  sanitizeSandboxResources,
  validLocalBwrap,
} from "../../src/services/cli-backend/cli-resources"

const configured = process.env.KILO_BWRAP_PATH

afterEach(() => {
  if (configured === undefined) {
    delete process.env.KILO_BWRAP_PATH
    return
  }
  process.env.KILO_BWRAP_PATH = configured
})

describe("local Bubblewrap helper", () => {
  it("copies the configured helper to a cache outside the extension", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-vscode-bwrap-"))
    try {
      const source = path.join(root, "source", "bwrap")
      const extension = path.join(root, "workspace", "packages", "kilo-vscode")
      const cache = path.join(root, "cache")
      await fs.mkdir(path.dirname(source), { recursive: true })
      await fs.writeFile(source, "bubblewrap")
      process.env.KILO_BWRAP_PATH = source

      const dest = await ensureBwrapForTarget("linux-x64", cache)

      expect(dest?.startsWith(extension)).toBe(false)
      expect(await fs.readFile(dest!, "utf8")).toBe("bubblewrap")
      expect((await fs.stat(dest!)).mode & 0o111).not.toBe(0)
      expect(resolveLocalBwrapEnv(extension, true, "linux-x64", cache)).toEqual({ KILO_BWRAP_PATH: dest })
      expect(resolveLocalBwrapEnv(extension, false, "linux-x64", cache)).toEqual({})
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("prefers a complete production helper bundled beside the CLI", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-vscode-bwrap-"))
    try {
      const extension = path.join(root, "extension")
      const bin = path.join(extension, "bin")
      const licenses = path.join(bin, "licenses", "bubblewrap")
      await fs.mkdir(licenses, { recursive: true })
      await fs.writeFile(path.join(bin, "bwrap"), "bundled")
      for (const file of ["NOTICE", "COPYING", "MUSL-COPYRIGHT", "build.ts"]) {
        await fs.writeFile(path.join(licenses, file), file)
      }
      await fs.writeFile(path.join(licenses, "bubblewrap-deadbeef.tar.gz"), "source")

      expect(resolveLocalBwrapEnv(extension, true, "linux-x64", path.join(root, "cache"))).toEqual({})
      expect(await sanitizeSandboxResources(bin, true)).toBe(true)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("removes an incomplete helper before local packaging", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-vscode-bwrap-"))
    try {
      const bin = path.join(root, "extension", "bin")
      const helper = path.join(bin, "bwrap")
      await fs.mkdir(bin, { recursive: true })
      await fs.writeFile(helper, "stale")

      expect(await sanitizeSandboxResources(bin, true)).toBe(false)
      expect(
        await fs.stat(helper).then(
          () => true,
          () => false,
        ),
      ).toBe(false)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("rejects a symlinked or public cache", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-vscode-bwrap-"))
    try {
      const source = path.join(root, "source")
      const cache = path.join(root, "cache")
      const dest = localBwrapPath("linux-x64", cache)!
      await fs.writeFile(source, "bubblewrap")
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.symlink(source, dest)
      await fs.writeFile(`${dest}.sha256`, "0".repeat(64))
      expect(validLocalBwrap(dest)).toBe(false)

      await fs.rm(cache, { recursive: true, force: true })
      await fs.mkdir(cache, { recursive: true, mode: 0o777 })
      await fs.chmod(cache, 0o777)
      process.env.KILO_BWRAP_PATH = source
      await expect(ensureBwrapForTarget("linux-x64", cache)).rejects.toThrow("cache directory is not private")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("does not stage Bubblewrap for unsupported operating systems", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-vscode-bwrap-"))
    try {
      process.env.KILO_BWRAP_PATH = path.join(root, "missing")

      const dest = await ensureBwrapForTarget("darwin-arm64", path.join(root, "cache"))

      expect(dest).toBeUndefined()
      expect(resolveLocalBwrapEnv(path.join(root, "extension"), true, "darwin-arm64", root)).toEqual({})
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
