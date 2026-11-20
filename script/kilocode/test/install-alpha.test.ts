import { describe, expect, test } from "bun:test"
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { assertInstallOwned, installFiles, kiloVersion, withInstallLock } from "../install-alpha"

type Scratch = { root: string; binDir: string; data: string; dest: string }

async function scratch(run: (paths: Scratch) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-alpha-test-"))
  const binDir = path.join(root, "bin")
  const data = path.join(binDir, ".kilo-alpha")
  const dest = path.join(binDir, "kilo")
  await mkdir(binDir, { recursive: true })
  try {
    await run({ root, binDir, data, dest })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function release(data: string, name: string) {
  const dir = path.join(data, name)
  const binary = path.join(dir, "kilo")
  await mkdir(dir, { recursive: true })
  await writeFile(binary, "")
  await chmod(binary, 0o755)
  return { dir, binary }
}

async function staged(root: string, version: string) {
  const bin = path.join(root, "staged")
  const executable = path.join(bin, "kilo")
  await mkdir(bin, { recursive: true })
  await writeFile(executable, `#!/bin/sh\necho "kilo v${version}"\n`)
  await chmod(executable, 0o755)
  return bin
}

describe("install:alpha ownership", () => {
  test("a missing destination is a fresh install", () =>
    scratch(async ({ data, dest }) => {
      expect(await assertInstallOwned(dest, data)).toBeUndefined()
    }))

  test("accepts its own symlink and returns the release directory", () =>
    scratch(async ({ data, dest }) => {
      const { dir, binary } = await release(data, "release-abc")
      await symlink(binary, dest)
      expect(await assertInstallOwned(dest, data)).toBe(dir)
    }))

  test("accepts a relative symlink into its own release", () =>
    scratch(async ({ data, dest }) => {
      const { dir } = await release(data, "release-abc")
      await symlink(path.join(".kilo-alpha", "release-abc", "kilo"), dest)
      expect(await assertInstallOwned(dest, data)).toBe(dir)
    }))

  test("refuses a regular file", () =>
    scratch(async ({ data, dest }) => {
      await writeFile(dest, "#!/bin/sh\n")
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(
        /exists but is not a symlink created by install:alpha/,
      )
    }))

  test("refuses a directory", () =>
    scratch(async ({ data, dest }) => {
      await mkdir(dest)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(
        /exists but is not a symlink created by install:alpha/,
      )
    }))

  test("refuses a symlink to an npm install", () =>
    scratch(async ({ root, data, dest }) => {
      const npm = path.join(root, "lib", "node_modules", "@kilocode", "cli", "kilo")
      await mkdir(path.dirname(npm), { recursive: true })
      await writeFile(npm, "")
      await symlink(npm, dest)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(/outside .*\.kilo-alpha/)
    }))

  test("refuses a symlink owned by another alpha name", () =>
    scratch(async ({ root, data, dest }) => {
      const { binary } = await release(path.join(root, "bin", ".other-alpha"), "release-abc")
      await symlink(binary, dest)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(/outside .*\.kilo-alpha/)
    }))

  test("refuses a symlink inside its directory but outside a release", () =>
    scratch(async ({ data, dest }) => {
      const current = path.join(data, "current")
      await mkdir(current, { recursive: true })
      await symlink(path.join(current, "kilo"), dest)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(/not a direct release-\*\/kilo entry/)
    }))

  test("refuses a sidecar instead of the executable", () =>
    scratch(async ({ data, dest }) => {
      const { dir } = await release(data, "release-abc")
      const sidecar = path.join(dir, "tree-sitter.wasm")
      await writeFile(sidecar, "")
      await chmod(sidecar, 0o755)
      await symlink(sidecar, dest)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(/not a direct release-\*\/kilo entry/)
    }))

  test("refuses a nested file instead of the direct executable", () =>
    scratch(async ({ data, dest }) => {
      const nested = path.join(data, "release-abc", "bin", "kilo")
      await mkdir(path.dirname(nested), { recursive: true })
      await writeFile(nested, "")
      await chmod(nested, 0o755)
      await symlink(nested, dest)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(/not a direct release-\*\/kilo entry/)
    }))

  test("refuses the release directory itself", () =>
    scratch(async ({ data, dest }) => {
      const { dir } = await release(data, "release-abc")
      await symlink(dir, dest)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(/not a direct release-\*\/kilo entry/)
    }))

  test("refuses a missing executable", () =>
    scratch(async ({ data, dest }) => {
      const { binary } = await release(data, "release-abc")
      await rm(binary)
      await symlink(binary, dest)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(/missing or not a regular executable file/)
    }))

  test("refuses an executable that is a symlink", () =>
    scratch(async ({ root, data, dest }) => {
      const { binary } = await release(data, "release-abc")
      const outside = path.join(root, "outside-kilo")
      await writeFile(outside, "")
      await chmod(outside, 0o755)
      await rm(binary)
      await symlink(outside, binary)
      await symlink(binary, dest)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(/missing or not a regular executable file/)
    }))

  test("refuses an executable that is a directory", () =>
    scratch(async ({ data, dest }) => {
      const { binary } = await release(data, "release-abc")
      await rm(binary)
      await mkdir(binary)
      await symlink(binary, dest)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(/missing or not a regular executable file/)
    }))

  test("refuses a regular file without an executable bit", () =>
    scratch(async ({ data, dest }) => {
      const { binary } = await release(data, "release-abc")
      await chmod(binary, 0o644)
      await symlink(binary, dest)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(/missing or not a regular executable file/)
    }))

  test("refuses a symlink whose release directory is gone", () =>
    scratch(async ({ data, dest }) => {
      await mkdir(data, { recursive: true })
      await symlink(path.join(data, "release-gone", "kilo"), dest)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(
        /release directory .* is missing or not a real directory/,
      )
    }))

  test("refuses a symlink that leaves the alpha directory through a release name", () =>
    scratch(async ({ data, dest }) => {
      await mkdir(path.join(data, "release-abc"), { recursive: true })
      await symlink(path.join(data, "release-abc", "..", "..", "elsewhere", "kilo"), dest)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(/outside .*\.kilo-alpha/)
    }))

  test("refuses a release directory that is a symlink", () =>
    scratch(async ({ root, data, dest }) => {
      const outside = path.join(root, "elsewhere")
      await mkdir(outside, { recursive: true })
      await mkdir(data, { recursive: true })
      await symlink(outside, path.join(data, "release-link"))
      await symlink(path.join(data, "release-link", "kilo"), dest)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(
        /release directory .* is missing or not a real directory/,
      )
    }))

  test("refuses when the alpha directory is a symlink or a file", () =>
    scratch(async ({ root, data, dest }) => {
      const real = path.join(root, "real-alpha")
      await mkdir(real, { recursive: true })
      await symlink(real, data)
      await expect(assertInstallOwned(dest, data)).rejects.toThrow(/not a directory created by install:alpha/)
    }))
})

describe("install:alpha activation", () => {
  test("a prune failure after the link moves keeps the new release active", () =>
    scratch(async ({ root, binDir, data, dest }) => {
      const source = await staged(root, "0.0.0-v2-4242")
      const locked = path.join(data, "release-stale", "locked")
      await mkdir(locked, { recursive: true })
      await writeFile(path.join(locked, "file"), "")
      await chmod(locked, 0o500)
      try {
        const installed = await installFiles(source, binDir, "kilo")
        expect(installed.version).toBe("0.0.0-v2-4242")
        const active = await realpath(dest)
        expect((await lstat(active)).isFile()).toBe(true)
        expect(path.basename(path.dirname(active)).startsWith("release-")).toBe(true)
        expect(await Bun.file(path.join(data, "install.lock")).exists()).toBe(false)
      } finally {
        await chmod(locked, 0o700)
      }
    }))
})

describe("install:alpha concurrency", () => {
  test("a held lock refuses a second update for the same name", () =>
    scratch(async ({ data }) => {
      await mkdir(data, { recursive: true })
      const entered = Promise.withResolvers<undefined>()
      const gate = Promise.withResolvers<undefined>()
      const first = withInstallLock(data, async () => {
        entered.resolve(undefined)
        await gate.promise
      })
      await entered.promise
      await expect(withInstallLock(data, async () => {})).rejects.toThrow(/Another install:alpha is already updating/)
      gate.resolve(undefined)
      await first
      expect(await withInstallLock(data, async () => "ok")).toBe("ok")
    }))

  test("the lock is scoped to one install directory", () =>
    scratch(async ({ root, data }) => {
      await mkdir(data, { recursive: true })
      const other = path.join(root, "other", ".kilo-alpha")
      await mkdir(other, { recursive: true })
      const entered = Promise.withResolvers<undefined>()
      const gate = Promise.withResolvers<undefined>()
      const first = withInstallLock(data, async () => {
        entered.resolve(undefined)
        await gate.promise
      })
      await entered.promise
      expect(await withInstallLock(other, async () => "ok")).toBe("ok")
      gate.resolve(undefined)
      await first
    }))

  test("a failed update releases the lock", () =>
    scratch(async ({ data }) => {
      await mkdir(data, { recursive: true })
      await expect(
        withInstallLock(data, async () => {
          throw new Error("boom")
        }),
      ).rejects.toThrow("boom")
      expect(await withInstallLock(data, async () => "ok")).toBe("ok")
    }))
})

describe("install:alpha binary identity", () => {
  test("accepts the v2 preview version line", () => {
    expect(kiloVersion("kilo v0.0.0-v2-226\n")).toBe("0.0.0-v2-226")
    expect(kiloVersion("kilo v0.0.0-v2-226.2")).toBe("0.0.0-v2-226.2")
    expect(kiloVersion("kilo v0.0.0-v2-202611191230")).toBe("0.0.0-v2-202611191230")
  })

  test("rejects another binary or channel", () => {
    for (const output of [
      "",
      "kilo v7.8.27",
      "opencode v2.3.0",
      "kilo v2.2.7",
      "kilo v0.0.0-v1-226",
      "kilo v0.0.0-v2-next",
      "kilo v0.0.0-v2-226\nextra",
    ])
      expect(() => kiloVersion(output)).toThrow(/not a Kilo v2 build/)
  })
})
