import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { cleanStaleInstalls, installArchive } from "../../src/browser/install"

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "chromium-install-"))
  const directory = path.join(base, "chromium-1244")
  const binary = path.join(directory, "chrome-linux64", "chrome")
  await fs.mkdir(path.dirname(binary), { recursive: true })
  await fs.writeFile(binary, "old")
  return { base, directory, binary }
}

describe("stale install leftovers", () => {
  test("a live pid's leftover is removed only once it is an hour old", async () => {
    const { base, directory } = await fixture()
    const now = Date.now()
    const live = path.join(base, `chromium-1244.staging-${process.pid}`)
    const stale = path.join(base, `chromium-1244.backup-${process.pid}`)
    for (const dir of [live, stale]) {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, "chrome"), "copy")
    }
    // The staging directory is fresh, the backup is two hours old; both belong to this live process.
    await fs.utimes(live, new Date(now - 60_000), new Date(now - 60_000))
    await fs.utimes(stale, new Date(now - 2 * 60 * 60 * 1000), new Date(now - 2 * 60 * 60 * 1000))
    await cleanStaleInstalls(directory, now)
    expect((await fs.stat(live).catch(() => null))?.isDirectory()).toBe(true)
    expect(await fs.stat(stale).catch(() => null)).toBeNull()
  })

  test("a dead pid's backup and staging directories are removed, a live pid's are kept", async () => {
    const { base, directory } = await fixture()
    const dead = path.join(base, "chromium-1244.backup-999999")
    const live = path.join(base, `chromium-1244.staging-${process.pid}`)
    const unrelated = path.join(base, "chromium-9999.backup-999998")
    for (const dir of [dead, live, unrelated]) {
      await fs.mkdir(path.join(dir, "chrome-linux64"), { recursive: true })
      await fs.writeFile(path.join(dir, "chrome-linux64", "chrome"), "copy")
    }
    await cleanStaleInstalls(directory)
    expect(await fs.stat(dead).catch(() => null)).toBeNull()
    // A live pid's directory belongs to a running install, and another browser revision is not ours.
    expect((await fs.stat(live).catch(() => null))?.isDirectory()).toBe(true)
    expect((await fs.stat(unrelated).catch(() => null))?.isDirectory()).toBe(true)
  })
})

describe("installing a browser archive", () => {
  test("a failed extraction keeps the browser that is already installed", async () => {
    const { base, directory, binary } = await fixture()
    const archive = path.join(base, "chromium.zip")
    await fs.writeFile(archive, "zip")
    const failure = await installArchive({
      directory,
      archive,
      executable: binary,
      extract: async () => {
        throw new Error("disk full")
      },
    }).catch((error: unknown) => error)
    expect(failure instanceof Error ? failure.message : String(failure)).toContain("disk full")
    // The working browser is untouched, so a failed install does not cost a re-download.
    expect(await fs.readFile(binary, "utf8")).toBe("old")
  })

  test("an archive without the executable is refused and the old one survives", async () => {
    const { base, directory, binary } = await fixture()
    const archive = path.join(base, "chromium.zip")
    await fs.writeFile(archive, "zip")
    const failure = await installArchive({
      directory,
      archive,
      executable: binary,
      extract: async (_zip, options) => {
        await fs.writeFile(path.join(options.dir, "unrelated.txt"), "x")
      },
    }).catch((error: unknown) => error)
    expect(failure instanceof Error ? failure.message : String(failure)).toContain("browser executable")
    expect(await fs.readFile(binary, "utf8")).toBe("old")
  })

  test("a failed move into place restores the old browser and reports the real error", async () => {
    const { base, directory, binary } = await fixture()
    const archive = path.join(base, "chromium.zip")
    await fs.writeFile(archive, "zip")
    const failure = await installArchive({
      directory,
      archive,
      executable: binary,
      extract: async (_zip, options) => {
        const staged = path.join(options.dir, "chrome-linux64", "chrome")
        await fs.mkdir(path.dirname(staged), { recursive: true })
        await fs.writeFile(staged, "new")
      },
      swap: async () => {
        throw new Error("rename failed")
      },
    }).catch((error: unknown) => error)
    expect(failure instanceof Error ? failure.message : String(failure)).toContain("rename failed")
    // The old install is back where it was, and no backup directory is left behind.
    expect(await fs.readFile(binary, "utf8")).toBe("old")
    expect((await fs.readdir(base)).filter((name) => name.includes(".backup-") || name.includes(".staging-"))).toEqual(
      [],
    )
  })

  test("a busy installed directory is reported with the real cause and keeps the old browser", async () => {
    const { base, directory, binary } = await fixture()
    const archive = path.join(base, "chromium.zip")
    await fs.writeFile(archive, "zip")
    const failure = await installArchive({
      directory,
      archive,
      executable: binary,
      extract: async (_zip, options) => {
        const staged = path.join(options.dir, "chrome-linux64", "chrome")
        await fs.mkdir(path.dirname(staged), { recursive: true })
        await fs.writeFile(staged, "new")
      },
      moveAside: async () => {
        throw Object.assign(new Error("resource busy"), { code: "EBUSY" })
      },
    }).catch((error: unknown) => error)
    const message = failure instanceof Error ? failure.message : String(failure)
    expect(message).toContain("EBUSY")
    expect(message).toContain("Close the browser and run install-chromium again")
    // The old browser is untouched and the staging directory is gone.
    expect(await fs.readFile(binary, "utf8")).toBe("old")
    expect((await fs.readdir(base)).filter((name) => name.includes(".staging-"))).toEqual([])
  })

  test("an unexpected move error keeps its own message and the original as cause", async () => {
    const { base, directory, binary } = await fixture()
    const archive = path.join(base, "chromium.zip")
    await fs.writeFile(archive, "zip")
    const original = Object.assign(new Error("permission denied by policy"), { code: "EACCES" })
    const failure = await installArchive({
      directory,
      archive,
      executable: binary,
      extract: async (_zip, options) => {
        const staged = path.join(options.dir, "chrome-linux64", "chrome")
        await fs.mkdir(path.dirname(staged), { recursive: true })
        await fs.writeFile(staged, "new")
      },
      moveAside: async () => {
        throw original
      },
    }).catch((error: unknown) => error)
    // The code is the detail when there is one, and the original error is preserved as the cause.
    expect(failure instanceof Error ? failure.message : String(failure)).toContain("EACCES")
    expect((failure as Error).cause).toBe(original)

    const noCode = await installArchive({
      directory,
      archive,
      executable: binary,
      extract: async (_zip, options) => {
        const staged = path.join(options.dir, "chrome-linux64", "chrome")
        await fs.mkdir(path.dirname(staged), { recursive: true })
        await fs.writeFile(staged, "new")
      },
      moveAside: async () => {
        throw new Error("sharing violation")
      },
    }).catch((error: unknown) => error)
    // Without a code the original message is what explains the failure.
    expect(noCode instanceof Error ? noCode.message : String(noCode)).toContain("sharing violation")
    expect(await fs.readFile(binary, "utf8")).toBe("old")
  })

  test("a complete archive replaces the old directory atomically", async () => {
    const { base, directory, binary } = await fixture()
    const archive = path.join(base, "chromium.zip")
    await fs.writeFile(archive, "zip")
    const installed = await installArchive({
      directory,
      archive,
      executable: binary,
      extract: async (_zip, options) => {
        const staged = path.join(options.dir, "chrome-linux64", "chrome")
        await fs.mkdir(path.dirname(staged), { recursive: true })
        await fs.writeFile(staged, "new")
      },
    })
    expect(installed).toBe(binary)
    expect(await fs.readFile(binary, "utf8")).toBe("new")
    // The marker playwright-core looks for, and no staging or backup directory left behind.
    expect(await fs.readFile(path.join(directory, "INSTALLATION_COMPLETE"), "utf8")).toBe("")
    expect((await fs.readdir(base)).filter((name) => name !== "chromium-1244" && name !== "chromium.zip")).toEqual([])
  })
})
