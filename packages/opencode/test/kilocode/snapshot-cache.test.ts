import { test, expect } from "bun:test"
import { $ } from "bun"
import { Snapshot } from "../../src/snapshot"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

async function bootstrap() {
  return tmpdir({
    git: true,
    init: async (dir) => {
      await Filesystem.write(`${dir}/a.txt`, "A")
      await Filesystem.write(`${dir}/b.txt`, "B")
      await $`git add .`.cwd(dir).quiet()
      await $`git commit --no-gpg-sign -m init`.cwd(dir).quiet()
    },
  })
}

test("diffFull returns cached result for same hash pair", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/a.txt`, "MODIFIED")
      const after = await Snapshot.track()
      expect(after).toBeTruthy()
      expect(after).not.toBe(before)

      const first = await Snapshot.diffFull(before!, after!)
      const second = await Snapshot.diffFull(before!, after!)

      // Should be the exact same array reference (cached)
      expect(second).toBe(first)
      expect(first.length).toBeGreaterThan(0)
    },
  })
})

test("diffFull returns empty array when from === to", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const hash = await Snapshot.track()
      expect(hash).toBeTruthy()

      const result = await Snapshot.diffFull(hash!, hash!)
      expect(result).toEqual([])
    },
  })
})

test("diffFull concurrent calls for same pair share one result", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/a.txt`, "CONCURRENT")
      const after = await Snapshot.track()
      expect(after).toBeTruthy()

      // Fire multiple concurrent calls — they should all resolve to the same object
      const results = await Promise.all([
        Snapshot.diffFull(before!, after!),
        Snapshot.diffFull(before!, after!),
        Snapshot.diffFull(before!, after!),
      ])

      expect(results[0]).toBe(results[1])
      expect(results[1]).toBe(results[2])
      expect(results[0].length).toBeGreaterThan(0)
    },
  })
})
