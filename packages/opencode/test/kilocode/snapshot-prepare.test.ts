import { afterEach, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { createKiloClient } from "@kilocode/sdk/v2"
import { Snapshot } from "../../src/snapshot"
import { Session } from "../../src/session/session"
import { Server } from "../../src/server/server"
import { InstanceState } from "../../src/effect/instance-state"
import { InstanceStore } from "../../src/project/instance-store"
import { KiloSnapshotPrepare } from "../../src/kilocode/snapshot/prepare"
import { KiloSnapshotMaterialize } from "../../src/kilocode/snapshot/materialize"
import {
  disposeAllInstances,
  provideInstance,
  reloadTestInstance,
  testInstanceStoreLayer,
  tmpdir,
  tmpdirScoped,
} from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { pollWithTimeout, testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

test("prepares a routed worktree once without tracking, then tracks current content without reseeding", async () => {
  await using source = await tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(path.join(dir, "note.txt"), "committed\n")
      await $`git add note.txt`.cwd(dir).quiet()
      await $`git commit -m baseline`.cwd(dir).quiet()
    },
  })
  await using root = await tmpdir()
  const dir = path.join(root.path, "worktree")
  await $`git worktree add --detach ${dir} HEAD`.cwd(source.path).quiet()
  const ctx = await reloadTestInstance({ directory: dir })
  const gitdir = path.join(Global.Path.data, "snapshot", ctx.project.id, Hash.fast(ctx.worktree))
  const app = Server.Default().app
  const headers = { "x-kilo-directory": dir }
  const route = "/kilocode/snapshot/prepare"
  expect(existsSync(gitdir)).toBe(false)

  const first = await app.request(route, { method: "POST", headers })
  expect(first.status).toBe(200)
  expect(await first.json()).toEqual({ prepared: true, durationMs: expect.any(Number) })
  expect(existsSync(path.join(gitdir, "HEAD"))).toBe(true)
  const index = await fs.readFile(path.join(gitdir, "index"))
  const stat = await fs.stat(path.join(gitdir, "index"))
  expect((await $`git --git-dir=${gitdir} ls-files`.text()).trim()).toBe("note.txt")
  expect((await $`git --git-dir=${gitdir} for-each-ref`.text()).trim()).toBe("")
  const sessions = await app.request("/session", { headers })
  expect(await sessions.json()).toEqual([])

  // A private config sentinel detects gitdir reinitialization without replacing the seed implementation.
  await $`git --git-dir=${gitdir} config core.autocrlf input`.quiet()
  const second = await Effect.runPromise(
    EffectFlock.Service.use((flock) =>
      flock.withLock(
        Effect.promise(async () => app.request(`${route}?directory=${encodeURIComponent(dir)}`, { method: "POST" })),
        `snapshot:${gitdir}`,
      ),
    ).pipe(Effect.timeout("5 seconds"), Effect.provide(AppNodeBuilder.build(EffectFlock.node))),
  )
  expect(second.status).toBe(200)
  expect(await second.json()).toEqual({ prepared: false, durationMs: expect.any(Number) })
  expect(await fs.readFile(path.join(gitdir, "index"))).toEqual(index)
  expect((await fs.stat(path.join(gitdir, "index"))).mtimeMs).toBe(stat.mtimeMs)
  expect((await $`git --git-dir=${gitdir} for-each-ref`.text()).trim()).toBe("")

  // Reload must not materialize a prepared index or manufacture a tracking ref.
  await reloadTestInstance({ directory: dir })
  const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
  try {
    const client = createKiloClient({ baseUrl: listener.url.toString() })
    const third = await client.kilocode.snapshot.prepare({ directory: dir }, { throwOnError: true })
    expect(third.response.status).toBe(200)
    expect(third.data).toEqual({ prepared: false, durationMs: expect.any(Number) })
  } finally {
    await listener.stop(true)
  }
  expect((await $`git --git-dir=${gitdir} for-each-ref`.text()).trim()).toBe("")

  await Bun.write(path.join(dir, "note.txt"), "changed after preparation\n")
  await Bun.write(path.join(dir, "new.txt"), "new file\n")
  const trace = path.join(root.path, "git-trace.jsonl")
  const previous = process.env.GIT_TRACE2_EVENT
  process.env.GIT_TRACE2_EVENT = trace
  const hash = await Effect.runPromise(
    Effect.gen(function* () {
      const snapshot = yield* Snapshot.Service
      const session = yield* (yield* Session.Service).create({ title: "prepared snapshot" })
      return yield* snapshot.track({ sessionID: session.id })
    }).pipe(
      provideInstance(dir),
      Effect.provide(Layer.mergeAll(AppNodeBuilder.build(Snapshot.node), AppNodeBuilder.build(Session.node))),
      Effect.provide(testInstanceStoreLayer),
    ),
  ).finally(() => {
    if (previous === undefined) delete process.env.GIT_TRACE2_EVENT
    if (previous !== undefined) process.env.GIT_TRACE2_EVENT = previous
  })
  expect(hash).toBeTruthy()
  expect(await $`git --git-dir=${gitdir} show ${hash!}:note.txt`.text()).toBe("changed after preparation\n")
  expect(await $`git --git-dir=${gitdir} show ${hash!}:new.txt`.text()).toBe("new file\n")
  expect((await $`git --git-dir=${gitdir} config core.autocrlf`.text()).trim()).toBe("input")
  expect((await $`git --git-dir=${gitdir} for-each-ref refs/kilo/snapshots`.text()).trim()).not.toBe("")
  expect(await Bun.file(trace).text()).not.toContain("--no-split-index")
  const alt = path.join(gitdir, "objects", "info", "alternates")
  await Effect.runPromise(
    pollWithTimeout(
      Effect.sync(() => (!existsSync(alt) && !existsSync(`${alt}.materializing`) ? true : undefined)),
      "snapshot materialization did not finish before fixture cleanup",
      "10 seconds",
    ),
  )
}, 30_000)

const it = testEffect(
  Layer.mergeAll(AppNodeBuilder.build(Snapshot.node), testInstanceStoreLayer).pipe(
    Layer.provideMerge(AppNodeBuilder.build(CrossSpawnSpawner.node)),
  ),
)

it.live(
  "prepared objects survive source pruning and later materialization preserves index-only recovery",
  () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({
        git: true,
        init: (dir) =>
          Effect.promise(async () => {
            await Bun.write(path.join(dir, "staged.txt"), "committed\n")
            await $`git add .`.cwd(dir).quiet()
            await $`git commit -m baseline`.cwd(dir).quiet()
            await Bun.write(path.join(dir, "staged.txt"), "staged dirty content\n")
            await $`git add staged.txt`.cwd(dir).quiet()
          }),
      })
      const git = (cmd: string[]) => Effect.promise(() => $`git ${cmd}`.cwd(dir).quiet().text())
      yield* Effect.gen(function* () {
        const snapshot = yield* Snapshot.Service
        const ctx = yield* InstanceState.context
        const gitdir = path.join(Global.Path.data, "snapshot", ctx.project.id, Hash.fast(ctx.worktree))
        const common = (yield* git(["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim()
        const ref = KiloSnapshotMaterialize.ref(gitdir)
        const alt = path.join(gitdir, "objects", "info", "alternates")
        const staging = path.join(gitdir, "seed-objects")
        const staged = (yield* git(["rev-parse", ":staged.txt"])).trim()

        expect(yield* KiloSnapshotPrepare.run(snapshot)).toBe(true)
        expect((yield* git(["--git-dir", gitdir, "for-each-ref"])).trim()).toBe("")
        const seed = (yield* git(["rev-parse", ref])).trim()

        // Keep one index entry exclusively in the snapshot-owned staging alternate.
        const file = path.join(dir, "private.txt")
        yield* Effect.promise(() => Bun.write(file, "quarantined content\n"))
        const privateHash = (yield* Effect.promise(() =>
          $`git --git-dir=${gitdir} hash-object -w ${file}`
            .env({ ...process.env, GIT_OBJECT_DIRECTORY: staging })
            .quiet()
            .text(),
        )).trim()
        yield* git(["--git-dir", gitdir, "update-index", "--add", "--cacheinfo", `100644,${privateHash},private.txt`])
        expect(existsSync(path.join(common, "objects", privateHash.slice(0, 2), privateHash.slice(2)))).toBe(false)

        // Remove the dirty blob from the source index, leaving only the seed pin to protect it.
        yield* git(["read-tree", "HEAD"])
        yield* git(["reflog", "expire", "--expire=now", "--all"])
        yield* git(["gc", "--prune=now"])
        yield* git(["prune", "--expire=now"])
        expect((yield* git(["rev-parse", `${ref}:staged.txt`])).trim()).toBe(staged)
        expect(yield* git(["--git-dir", gitdir, "show", `${seed}:staged.txt`])).toBe("staged dirty content\n")
        expect(yield* git(["--git-dir", gitdir, "cat-file", "blob", privateHash])).toBe("quarantined content\n")

        yield* (yield* InstanceStore.Service).dispose(ctx)
        yield* snapshot.init().pipe(provideInstance(dir))
        expect(yield* KiloSnapshotPrepare.run(snapshot).pipe(provideInstance(dir))).toBe(false)
        expect((yield* git(["--git-dir", gitdir, "for-each-ref"])).trim()).toBe("")
        expect(yield* git(["--git-dir", gitdir, "cat-file", "blob", privateHash])).toBe("quarantined content\n")

        const hash = yield* snapshot.track().pipe(provideInstance(dir))
        expect(hash).toBeTruthy()
        const wait = pollWithTimeout(
          Effect.sync(() => (!existsSync(alt) && !existsSync(`${alt}.materializing`) ? true : undefined)),
          "snapshot materialization did not finish",
          "5 seconds",
        )
        yield* wait
        expect(existsSync(staging)).toBe(false)
        expect((yield* git(["for-each-ref", ref])).trim()).toBe("")
        expect(yield* git(["--git-dir", gitdir, "show", `${hash}:staged.txt`])).toBe("staged dirty content\n")
        expect(yield* git(["--git-dir", gitdir, "show", `${hash}:private.txt`])).toBe("quarantined content\n")
        yield* git(["--git-dir", gitdir, "fsck", "--connectivity-only", "--no-dangling", "--no-reflogs"])

        // Existing index-only repositories must still use the materializer's fallback pin.
        const refs = (yield* git(["--git-dir", gitdir, "for-each-ref", "--format=%(refname)"])).trim().split("\n")
        for (const ref of refs) yield* git(["--git-dir", gitdir, "update-ref", "-d", ref])
        yield* Effect.promise(() => fs.writeFile(alt, `${path.join(common, "objects")}\n`))
        yield* git(["update-ref", ref, seed])
        const current = yield* InstanceState.context.pipe(provideInstance(dir))
        yield* (yield* InstanceStore.Service).dispose(current)
        yield* snapshot.init().pipe(provideInstance(dir))
        yield* wait
        expect((yield* git(["--git-dir", gitdir, "for-each-ref", "refs/kilo/snapshots"])).trim()).not.toBe("")
        expect((yield* git(["for-each-ref", ref])).trim()).toBe("")
      }).pipe(provideInstance(dir))
    }),
  30_000,
)

test("does not prepare disabled snapshots or directories outside git", async () => {
  for (const opts of [{ git: true, config: { snapshot: false } }, {}]) {
    await using tmp = await tmpdir(opts)
    const ctx = await reloadTestInstance({ directory: tmp.path })
    const response = await Server.Default().app.request("/kilocode/snapshot/prepare", {
      method: "POST",
      headers: { "x-kilo-directory": tmp.path },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ prepared: false, durationMs: expect.any(Number) })
    expect(existsSync(path.join(Global.Path.data, "snapshot", ctx.project.id, Hash.fast(ctx.worktree)))).toBe(false)
  }
}, 30_000)
