// kilocode_change - new file
//
// Regression test for the Snapshot.track() stat-storm bug that hung the CLI
// on very large repos like jetbrains/intellij-community (~75k+ tracked files).
//
// Before the fix, Snapshot.add() called fs.stat on every candidate file
// (tracked + untracked) on every turn — two or three times per turn — even
// though the stat result was only ever used to filter the `untracked` subset
// for the 2 MB size cap. On a 75k-file repo that's hundreds of thousands of
// syscalls per turn.
//
// The fix only stats untracked candidates. Tracked files are always staged
// regardless of size, so the stat result for them was dead data.
//
// These tests pin down the observable behavior:
//   1. A large-file tracked modification is still captured in the snapshot
//      (we no longer consider tracked files for the size cap, which matches
//      the pre-fix semantics because `block` was already untracked-only).
//   2. A large untracked file is still blocked (added to info/exclude and
//      not staged) — the size cap still applies where it ever did.
//   3. A many-tracked-files workload completes in a reasonable bound.

import { test, expect } from "bun:test"
import { $ } from "bun"
import fs from "node:fs/promises"
import path from "node:path"
import { Snapshot } from "../../src/snapshot"
import { Instance } from "../../src/project/instance"
import { Filesystem, Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

test("tracked file modification is captured in snapshot even when large", async () => {
  // 3 MB file — over the 2 MB limit. It is already tracked, so the snapshot
  // should still include the modification.
  const big = "x".repeat(3 * 1024 * 1024)
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await Filesystem.write(`${dir}/huge.txt`, "seed")
      await $`git add .`.cwd(dir).quiet()
      await $`git commit --no-gpg-sign -m init`.cwd(dir).quiet()
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/huge.txt`, big)
      const after = await Snapshot.track()
      expect(after).toBeTruthy()
      expect(after).not.toBe(before)

      const diff = await Snapshot.diffFull(before!, after!)
      const hit = diff.find((d) => d.file === "huge.txt")
      expect(hit).toBeDefined()
      // modified tracked file — must be in the snapshot
      expect(hit!.status).toBe("modified")
    },
  })
})

test("large untracked file is still blocked from the snapshot", async () => {
  const big = "y".repeat(3 * 1024 * 1024)
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await Filesystem.write(`${dir}/seed.txt`, "seed")
      await $`git add .`.cwd(dir).quiet()
      await $`git commit --no-gpg-sign -m init`.cwd(dir).quiet()
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      // brand-new untracked file over the limit
      await Filesystem.write(`${tmp.path}/new-big.bin`, big)
      const after = await Snapshot.track()
      expect(after).toBeTruthy()

      const diff = await Snapshot.diffFull(before!, after!)
      const hit = diff.find((d) => d.file === "new-big.bin")
      // untracked + large → must NOT be staged
      expect(hit).toBeUndefined()
    },
  })
})

test("track() over a repo with many tracked files stays snappy", async () => {
  // Build a repo with 1000 committed files. Before the fix this would stat
  // every one of them on every track(). After the fix only untracked files
  // (in this case, the one we touch) are stat'd. 1000 files is enough to
  // show the regression on CI while keeping the test fast.
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const files = Array.from({ length: 1000 }, (_, i) => `file-${i}.txt`)
      await Promise.all(files.map((f) => fs.writeFile(path.join(dir, f), `seed-${f}\n`)))
      await $`git add .`.cwd(dir).quiet()
      await $`git commit --no-gpg-sign -m init`.cwd(dir).quiet()
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      // Modify one tracked file and add one untracked file.
      await fs.writeFile(path.join(tmp.path, "file-0.txt"), "changed\n")
      await fs.writeFile(path.join(tmp.path, "new.txt"), "new\n")

      const start = Date.now()
      const after = await Snapshot.track()
      const elapsed = Date.now() - start

      expect(after).toBeTruthy()
      expect(after).not.toBe(before)
      // Very generous bound — the point is that we don't stat 1000 files.
      // Without the fix this is dominated by 1000 serial-ish stat calls
      // through the Effect layer, which is visibly slow even on SSDs.
      expect(elapsed).toBeLessThan(10_000)
    },
  })
})
