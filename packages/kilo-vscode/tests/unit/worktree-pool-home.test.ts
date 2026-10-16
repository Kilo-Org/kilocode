import { afterEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { locate, poolDir, poolHome } from "../../src/agent-manager/pool/home"

const dirs: string[] = []
const xdg = process.env.XDG_DATA_HOME

async function temp(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kilo-pool-home-")))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  if (xdg === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = xdg
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("worktree pool home", () => {
  it("lives next to the Kilo CLI data and honors XDG_DATA_HOME", () => {
    process.env.XDG_DATA_HOME = path.join(os.tmpdir(), "data")
    expect(poolHome()).toBe(path.join(os.tmpdir(), "data", "kilo", "worktree-pool"))
    delete process.env.XDG_DATA_HOME
    expect(poolHome()).toBe(path.join(os.homedir(), ".local", "share", "kilo", "worktree-pool"))
  })

  it("gives every repository a stable, readable directory", async () => {
    const root = await temp()
    const one = path.join(root, "libxml2-feedstock")
    const two = path.join(root, "other", "libxml2-feedstock")
    await fs.mkdir(one, { recursive: true })
    await fs.mkdir(two, { recursive: true })

    expect(poolDir("/home", one)).toBe(poolDir("/home", one))
    expect(poolDir("/home", one)).not.toBe(poolDir("/home", two))
    expect(path.basename(poolDir("/home", one))).toMatch(/^libxml2-feedstock-[0-9a-f]{12}$/)
  })

  it("uses the pool home on the filesystem of the project and creates nothing in the project", async () => {
    const root = await temp()
    const home = path.join(root, "pool")
    const project = path.join(root, "project")
    await fs.mkdir(project)

    expect(await locate(project, path.join(home, "repo"), () => undefined)).toBe(path.join(home, "repo"))
    expect(await fs.readdir(project)).toEqual([])
  })

  it.skipIf(process.platform === "win32")("uses no pool home on another filesystem", async () => {
    const home = path.join(await temp(), "pool")
    expect(await locate("/dev", path.join(home, "dev"), () => undefined)).toBeUndefined()
  })

  it("uses no pool home when it cannot be created", async () => {
    const root = await temp()
    const home = path.join(root, "pool")
    await fs.writeFile(home, "file")
    const logs: string[] = []

    expect(await locate(root, path.join(home, "repo"), (msg) => logs.push(msg))).toBeUndefined()
    expect(logs.some((line) => line.includes("cannot use"))).toBe(true)
  })
})
