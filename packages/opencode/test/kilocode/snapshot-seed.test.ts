import { afterEach, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import { Snapshot } from "../../src/snapshot"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { disposeAllInstances, provideInstance, tmpdir } from "../fixture/fixture"

const fwd = (...parts: string[]) => path.join(...parts).replaceAll("\\", "/")

function run<A>(dir: string, body: (snapshot: Snapshot.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const snapshot = yield* Snapshot.Service
      const value = yield* body(snapshot)
      const gitdir = path.join(Global.Path.data, "snapshot", Instance.project.id, Hash.fast(Instance.worktree))
      return { value, gitdir }
    }).pipe(provideInstance(dir), Effect.provide(Snapshot.defaultLayer)),
  )
}

async function setup(dir: string) {
  await $`git config core.autocrlf false`.cwd(dir).quiet()
  await $`git config filter.snapshot-test.clean "tr a-z A-Z"`.cwd(dir).quiet()
  await $`git config filter.snapshot-test.smudge cat`.cwd(dir).quiet()
  await $`git config filter.snapshot-test.required true`.cwd(dir).quiet()
  await Filesystem.write(path.join(dir, "dirty.txt"), "committed dirty\n")
  await Filesystem.write(path.join(dir, "staged.txt"), "committed staged\n")
  await Filesystem.write(path.join(dir, "deleted.txt"), "committed deleted\n")
  await Filesystem.write(path.join(dir, "tracked.log"), "tracked but ignored\n")
  await Filesystem.write(path.join(dir, "filtered.flt"), "committed filtered\n")
  await Filesystem.write(path.join(dir, "script.sh"), "#!/bin/sh\nexit 0\n")
  await Filesystem.write(path.join(dir, "huge.bin"), new Uint8Array(2 * 1024 * 1024 + 1))
  await Filesystem.write(path.join(dir, ".gitattributes"), "*.flt filter=snapshot-test\n")
  await $`git add .`.cwd(dir).quiet()
  await $`git commit -m baseline`.cwd(dir).quiet()
  await Filesystem.write(path.join(dir, ".gitignore"), "*.log\n")
  await $`git add .gitignore`.cwd(dir).quiet()
  await $`git commit -m ignore`.cwd(dir).quiet()
}

async function dirty(dir: string) {
  await Filesystem.write(path.join(dir, "dirty.txt"), "user dirty\n")
  await Filesystem.write(path.join(dir, "staged.txt"), "user staged\n")
  await $`git add staged.txt`.cwd(dir).quiet()
  await fs.rm(path.join(dir, "deleted.txt"))
  await Filesystem.write(path.join(dir, "untracked.txt"), "user untracked\n")
  await Filesystem.write(path.join(dir, "filtered.flt"), "user filtered\n")
  await Filesystem.write(path.join(dir, "debug.log"), "ignored untracked\n")
  if (process.platform !== "win32") await fs.chmod(path.join(dir, "script.sh"), 0o755)
}

afterEach(async () => {
  await disposeAllInstances()
})

test(
  "Agent Manager cold seed matches full snapshot and preserves first-turn reset",
  async () => {
    await using source = await tmpdir({
      git: true,
      init: setup,
    })
    await using root = await tmpdir()
    const seeded = path.join(root.path, "seeded")
    await $`git worktree add --quiet -b snapshot-seed-test ${seeded} HEAD`.cwd(source.path)

    await dirty(source.path)
    await dirty(seeded)

    const cold = await run(source.path, (snapshot) => snapshot.track())
    const fast = await run(seeded, (snapshot) => snapshot.track({ snapshotInitialization: "wait" }))

    expect(cold.value).toBeTruthy()
    expect(fast.value).toBe(cold.value)
    await expect(fs.access(path.join(cold.gitdir, "objects", "info", "alternates"))).rejects.toThrow()
    const common = (await $`git rev-parse --path-format=absolute --git-common-dir`.cwd(seeded).text()).trim()
    expect((await fs.readFile(path.join(fast.gitdir, "objects", "info", "alternates"), "utf8")).trim()).toBe(
      path.join(common, "objects"),
    )

    expect((await run(seeded, (snapshot) => snapshot.patch(fast.value!))).value.files).toEqual([])

    await Filesystem.write(path.join(seeded, "dirty.txt"), "assistant dirty\n")
    await Filesystem.write(path.join(seeded, "untracked.txt"), "assistant untracked\n")
    await Filesystem.write(path.join(seeded, "created.txt"), "assistant created\n")
    const patch = (await run(seeded, (snapshot) => snapshot.patch(fast.value!))).value
    expect(patch.files).toEqual(
      expect.arrayContaining([fwd(seeded, "dirty.txt"), fwd(seeded, "untracked.txt"), fwd(seeded, "created.txt")]),
    )

    await run(seeded, (snapshot) => snapshot.revert([patch]))
    expect(await fs.readFile(path.join(seeded, "dirty.txt"), "utf8")).toBe("user dirty\n")
    expect(await fs.readFile(path.join(seeded, "untracked.txt"), "utf8")).toBe("user untracked\n")
    await expect(fs.access(path.join(seeded, "created.txt"))).rejects.toThrow()
    await expect(fs.access(path.join(seeded, "deleted.txt"))).rejects.toThrow()
  },
  { timeout: 15_000 },
)

test("Agent Manager seed falls back for sparse checkouts", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await Filesystem.write(path.join(dir, "tracked.txt"), "tracked\n")
      await $`git add tracked.txt`.cwd(dir).quiet()
      await $`git commit -m tracked`.cwd(dir).quiet()
      await $`git config core.sparseCheckout true`.cwd(dir).quiet()
    },
  })

  const result = await run(tmp.path, (snapshot) => snapshot.track({ snapshotInitialization: "wait" }))
  expect(result.value).toBeTruthy()
  await expect(fs.access(path.join(result.gitdir, "objects", "info", "alternates"))).rejects.toThrow()
})
