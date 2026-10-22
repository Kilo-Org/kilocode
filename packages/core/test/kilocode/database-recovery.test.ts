import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Layer } from "effect"
import { tmpdir } from "../fixture/tmpdir"

const wait = async (dir: string, glob: string, count = 1, end = Date.now() + 5_000): Promise<void> => {
  const files = await Array.fromAsync(new Bun.Glob(glob).scan({ cwd: dir }))
  if (files.length >= count) return
  if (Date.now() >= end) throw new Error(`Timed out waiting for ${glob}`)
  await Bun.sleep(1)
  return wait(dir, glob, count, end)
}

const remove = async (file: string, retry = 30): Promise<void> => {
  try {
    await fs.rm(file, { force: true })
  } catch (err) {
    if (retry === 0 || !err || typeof err !== "object" || !("code" in err) || err.code !== "EBUSY") throw err
    await Bun.sleep(100)
    return remove(file, retry - 1)
  }
}

describe("database WAL recovery", () => {
  test("starts concurrent processes while recovering an abandoned WAL", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "kilo.db")
    await Effect.runPromise(Layer.build(Database.layerFromPath(file).pipe(Layer.fresh)).pipe(Effect.scoped))

    const worker = path.join(import.meta.dir, "fixture/database-recovery-worker.ts")
    const seed = Bun.spawn([process.execPath, worker, "seed", tmp.path], { stdout: "ignore", stderr: "pipe" })
    try {
      await wait(tmp.path, "seed-ready")
    } finally {
      if (seed.exitCode === null) seed.kill(9)
      await seed.exited
    }

    await remove(`${file}-shm`)
    const children: (typeof seed)[] = []
    try {
      for (const _ of Array.from({ length: 12 }))
        children.push(Bun.spawn([process.execPath, worker, "open", tmp.path], { stdout: "ignore", stderr: "pipe" }))
      await wait(tmp.path, "open-ready-*", children.length)
      await Bun.write(path.join(tmp.path, "start"), "")

      const statuses = await Promise.all(children.map((child) => child.exited))
      const errors = await Promise.all(children.map((child) => new Response(child.stderr).text()))
      if (statuses.some((status) => status !== 0)) throw new Error(errors.filter(Boolean).join("\n"))
      expect(statuses).toEqual(Array.from({ length: children.length }, () => 0))
    } finally {
      for (const child of children) if (child.exitCode === null) child.kill(9)
      await Promise.all(children.map((child) => child.exited))
    }
  }, 20_000)
})
