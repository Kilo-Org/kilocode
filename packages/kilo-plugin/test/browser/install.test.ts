import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { installArchive } from "../../src/browser/install"

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "chromium-install-"))
  const directory = path.join(base, "chromium-1244")
  const binary = path.join(directory, "chrome-linux64", "chrome")
  await fs.mkdir(path.dirname(binary), { recursive: true })
  await fs.writeFile(binary, "old")
  return { base, directory, binary }
}

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
