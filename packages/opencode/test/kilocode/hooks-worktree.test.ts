import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ConfigProvider, Effect, Fiber, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { Flag } from "@opencode-ai/core/flag/flag"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Database } from "@opencode-ai/core/database/database"
import { Config } from "@/config/config"
import { Git } from "@/git"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { Server } from "@/server/server"
import { ServerAuth } from "@/server/auth"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { Worktree } from "@/worktree"
import type { KiloHooks } from "@/kilocode/hooks/hooks"
import { KiloHookWorktree } from "@/kilocode/hooks/worktree"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance, tmpdir } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

// Exec-form hooks need no shell quoting: `bun -e <code>`.
const exec = (code: string): KiloHooks.Handler => ({ type: "command", command: process.execPath, args: ["-e", code] })
// A hook that appends its stdin plus the worktree env vars (one JSON line) to a marker file, then runs `extra`.
const record = (file: string, extra = "") =>
  exec(
    `const fs = require('fs'); const input = JSON.parse(fs.readFileSync(0, 'utf8')); fs.appendFileSync(${JSON.stringify(file)}, JSON.stringify({ ...input, env: { WORKTREE_PATH: process.env.WORKTREE_PATH, REPO_PATH: process.env.REPO_PATH }, pwd: process.cwd() }) + '\\n'); ${extra}`,
  )
const lines = async (file: string) =>
  (await Bun.file(file).exists())
    ? (await Bun.file(file).text())
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : []

/** Trusted hooks: a managed config directory (project config hooks are ignored). Returns a restore. */
async function managed(hooks: KiloHooks.Hooks) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-hooks-managed-"))
  await Bun.write(path.join(dir, "kilo.json"), JSON.stringify({ hooks }))
  const prev = process.env.KILO_TEST_MANAGED_CONFIG_DIR
  process.env.KILO_TEST_MANAGED_CONFIG_DIR = dir
  return async () => {
    if (prev === undefined) delete process.env.KILO_TEST_MANAGED_CONFIG_DIR
    else process.env.KILO_TEST_MANAGED_CONFIG_DIR = prev
    await fs.rm(dir, { recursive: true, force: true })
  }
}

function post(root: string, route: string, body: unknown) {
  return Server.Default().app.request(`${route}?directory=${encodeURIComponent(root)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-kilo-directory": root },
    body: JSON.stringify(body),
  })
}

const setup = (root: string, worktree: string, extra: Record<string, unknown> = {}) =>
  post(root, "/kilocode/hooks/dispatch", {
    event: "WorktreeSetup",
    worktree,
    branch: "feature/hooks",
    parentBranch: "main",
    origin: "create",
    script: "succeeded",
    ...extra,
  })

describe("WorktreeSetup dispatch", () => {
  afterEach(async () => {
    await disposeAllInstances()
    await resetDatabase()
  })

  test("runs trusted hooks in the worktree with its env and payload", async () => {
    await using tmp = await tmpdir({ git: true })
    const marker = path.join(tmp.path, "..", `${path.basename(tmp.path)}-setup`)
    const worktree = path.join(tmp.path, ".kilo", "worktrees", "feature")
    await fs.mkdir(worktree, { recursive: true })
    const restore = await managed({ WorktreeSetup: [{ matcher: "create|promote", hooks: [record(marker)] }] })
    try {
      const res = await setup(tmp.path, worktree)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ blocked: false })
      const inputs = await lines(marker)
      expect(inputs).toHaveLength(1)
      expect(inputs.at(0)).toMatchObject({
        hook_event_name: "WorktreeSetup",
        worktree_path: worktree,
        repo_path: tmp.path,
        branch: "feature/hooks",
        parent_branch: "main",
        origin: "create",
        setup_script: "succeeded",
        env: { WORKTREE_PATH: worktree, REPO_PATH: tmp.path },
      })
      expect(await fs.realpath(String(inputs.at(0)?.pwd))).toBe(await fs.realpath(worktree))
      // The matcher is the origin: an import does not run a create|promote hook.
      expect((await setup(tmp.path, worktree, { origin: "import" })).status).toBe(200)
      expect(await lines(marker)).toHaveLength(1)
    } finally {
      await restore()
      await fs.rm(marker, { force: true })
    }
  })

  test("a blocking hook marks setup failed with its reason", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktree = path.join(tmp.path, ".kilo", "worktrees", "blocked")
    await fs.mkdir(worktree, { recursive: true })
    const restore = await managed({
      WorktreeSetup: [{ hooks: [exec("process.stderr.write('no free port'); process.exit(2)")] }],
    })
    try {
      const res = await setup(tmp.path, worktree)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ blocked: true, reason: "no free port" })
    } finally {
      await restore()
    }
  })

  test("rejects worktrees outside .kilo/worktrees/<name> or through a symlink without running hooks", async () => {
    await using tmp = await tmpdir({ git: true })
    await using outside = await tmpdir()
    const marker = path.join(outside.path, "marker")
    const worktree = path.join(tmp.path, ".kilo", "worktrees", "real")
    await fs.mkdir(worktree, { recursive: true })
    await fs.symlink(outside.path, path.join(tmp.path, ".kilo", "worktrees", "linked"), "dir")
    const restore = await managed({ WorktreeSetup: [{ hooks: [record(marker)] }] })
    try {
      for (const target of [
        tmp.path,
        outside.path,
        path.join(worktree, "nested"),
        path.join(tmp.path, ".kilo", "worktrees", "..", ".."),
        path.join(tmp.path, ".kilo", "worktrees", "linked"),
        "relative/path",
      ]) {
        const res = await setup(tmp.path, target)
        expect(res.status).toBe(400)
      }
      // Only WorktreeSetup can be dispatched: server-side events are not accepted.
      const forged = await post(tmp.path, "/kilocode/hooks/dispatch", {
        event: "PreToolUse",
        worktree,
        origin: "create",
        script: "none",
      })
      expect(forged.status).toBe(400)
      expect(await lines(marker)).toEqual([])
    } finally {
      await restore()
    }
  })

  test("ignores WorktreeSetup hooks from the project's own config", async () => {
    await using tmp = await tmpdir({ git: true })
    const marker = path.join(tmp.path, "..", `${path.basename(tmp.path)}-project`)
    await Bun.write(
      path.join(tmp.path, "kilo.json"),
      JSON.stringify({
        hooks: {
          WorktreeSetup: [{ hooks: [record(marker, "process.stderr.write('project says no'); process.exit(2)")] }],
        },
      }),
    )
    const worktree = path.join(tmp.path, ".kilo", "worktrees", "project")
    await fs.mkdir(worktree, { recursive: true })
    try {
      const res = await setup(tmp.path, worktree)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ blocked: false })
      expect(await lines(marker)).toEqual([])
    } finally {
      await fs.rm(marker, { force: true })
    }
  })

  test("concurrent dispatches for one worktree share one hook run", async () => {
    await using tmp = await tmpdir({ git: true })
    const marker = path.join(tmp.path, "..", `${path.basename(tmp.path)}-flight`)
    const worktree = path.join(tmp.path, ".kilo", "worktrees", "flight")
    await fs.mkdir(worktree, { recursive: true })
    const restore = await managed({
      WorktreeSetup: [{ hooks: [record(marker, "setTimeout(() => {}, 500)")] }],
    })
    try {
      const results = await Promise.all([setup(tmp.path, worktree), setup(tmp.path, worktree)])
      expect(results.map((res) => res.status)).toEqual([200, 200])
      expect(await Promise.all(results.map((res) => res.json()))).toEqual([{ blocked: false }, { blocked: false }])
      expect(await lines(marker)).toHaveLength(1)
    } finally {
      await restore()
      await fs.rm(marker, { force: true })
    }
  })
})

// The teardown route always requires server auth, so it is driven through an authenticated app.
function secured(password: string) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            KILO_SERVER_PASSWORD: password,
            KILO_EXPERIMENTAL_DISABLE_FILEWATCHER: process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER ?? "true",
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler
  const authorization = ServerAuth.header({ username: "kilo", password }) ?? ""
  return (root: string, body: unknown) =>
    handler(
      new Request(new URL(`/kilocode/worktree/teardown?directory=${encodeURIComponent(root)}`, "http://localhost"), {
        method: "POST",
        headers: { "content-type": "application/json", "x-kilo-directory": root, authorization },
        body: JSON.stringify(body),
      }),
      HttpApiApp.context,
    )
}

describe("WorktreeTeardown", () => {
  const original = {
    password: Flag.KILO_SERVER_PASSWORD,
    username: Flag.KILO_SERVER_USERNAME,
    env: process.env.KILO_SERVER_PASSWORD,
  }

  afterEach(async () => {
    Flag.KILO_SERVER_PASSWORD = original.password
    Flag.KILO_SERVER_USERNAME = original.username
    if (original.env === undefined) delete process.env.KILO_SERVER_PASSWORD
    else process.env.KILO_SERVER_PASSWORD = original.env
    await disposeAllInstances()
    await resetDatabase()
  })

  test("runs before the Agent Manager removes a worktree and cannot block it", async () => {
    await using tmp = await tmpdir({ git: true })
    const marker = path.join(tmp.path, "..", `${path.basename(tmp.path)}-teardown`)
    const worktree = path.join(tmp.path, ".kilo", "worktrees", "done")
    await fs.mkdir(worktree, { recursive: true })
    const restore = await managed({
      WorktreeTeardown: [{ hooks: [record(marker, "process.stderr.write('keep it'); process.exit(2)")] }],
    })
    Flag.KILO_SERVER_PASSWORD = "secret"
    Flag.KILO_SERVER_USERNAME = undefined
    process.env.KILO_SERVER_PASSWORD = "secret"
    const teardown = secured("secret")
    try {
      const res = await teardown(tmp.path, { worktree })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ disposed: false })
      expect(await lines(marker)).toEqual([
        expect.objectContaining({
          hook_event_name: "WorktreeTeardown",
          worktree_path: worktree,
          repo_path: tmp.path,
          env: { WORKTREE_PATH: worktree, REPO_PATH: tmp.path },
        }),
      ])
      // A path the endpoint rejects runs no hook.
      expect((await teardown(tmp.path, { worktree: tmp.path })).status).toBe(400)
      expect(await lines(marker)).toHaveLength(1)
    } finally {
      await restore()
      await fs.rm(marker, { force: true })
    }
  })
})

describe("CLI worktrees", () => {
  const it = testEffect(
    LayerNode.compile(LayerNode.group([Worktree.node, FSUtil.node, Git.node, Config.node, Database.node]), [
      [InstanceStore.bootstrapNode, InstanceBootstrap.node],
    ]),
  )

  // The instance reads its config while it boots, before the test body: install hooks first.
  const hooks = (value: (root: string) => KiloHooks.Hooks) => ({
    git: true,
    init: (root: string) =>
      Effect.acquireRelease(
        Effect.promise(() => managed(value(root))),
        (restore) => Effect.promise(restore),
      ).pipe(Effect.asVoid),
  })
  const markerFor = (root: string, name: string) => path.join(root, "..", `${path.basename(root)}-${name}`)

  it.instance(
    "runs WorktreeTeardown once for a worktree git lists, with the path git lists",
    () =>
      Effect.gen(function* () {
        const root = (yield* TestInstance).directory
        const marker = markerFor(root, "cli-teardown")
        yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(marker, { force: true })))
        const dir = path.join(root, "..", `${path.basename(root)}-listed`)
        yield* Effect.promise(() => $`git worktree add --no-checkout -b listed ${dir}`.cwd(root).quiet())
        const svc = yield* Worktree.Service
        expect(yield* svc.remove({ directory: dir })).toBe(true)
        const inputs = yield* Effect.promise(() => lines(marker))
        expect(inputs).toHaveLength(1)
        expect(path.basename(String(inputs.at(0)?.worktree_path))).toBe(path.basename(dir))
        expect(inputs.at(0)?.repo_path).toBe(root)
        // The hook ran while the directory still existed, inside it; removal then went ahead.
        expect(path.basename(String(inputs.at(0)?.pwd))).toBe(path.basename(dir))
        expect(
          yield* Effect.promise(() =>
            fs.stat(dir).then(
              () => true,
              () => false,
            ),
          ),
        ).toBe(false)
      }),
    hooks((root) => ({ WorktreeTeardown: [{ hooks: [record(markerFor(root, "cli-teardown"))] }] })),
  )

  it.instance(
    "runs no WorktreeTeardown for a directory git does not list, which is still removed",
    () =>
      Effect.gen(function* () {
        const root = (yield* TestInstance).directory
        const marker = markerFor(root, "cli-unlisted")
        yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(marker, { force: true })))
        const dir = path.join(root, "..", `${path.basename(root)}-orphan`)
        yield* Effect.promise(() => fs.mkdir(dir, { recursive: true }))
        const svc = yield* Worktree.Service
        expect(yield* svc.remove({ directory: dir })).toBe(true)
        expect(yield* Effect.promise(() => lines(marker))).toHaveLength(0)
        expect(
          yield* Effect.promise(() =>
            fs.stat(dir).then(
              () => true,
              () => false,
            ),
          ),
        ).toBe(false)
      }),
    hooks((root) => ({ WorktreeTeardown: [{ hooks: [record(markerFor(root, "cli-unlisted"))] }] })),
  )

  it.instance(
    "a dispatch whose shared run was cancelled runs the hooks itself",
    () =>
      Effect.gen(function* () {
        const root = (yield* TestInstance).directory
        const marker = markerFor(root, "retry")
        yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(marker, { force: true })))
        const worktree = path.join(root, ".kilo", "worktrees", "retry")
        yield* Effect.promise(() => fs.mkdir(worktree, { recursive: true }))
        const input = {
          event: "WorktreeSetup" as const,
          worktree,
          root,
          origin: "create" as const,
          script: "none" as const,
        }
        const first = yield* KiloHookWorktree.dispatch(input).pipe(Effect.forkChild)
        yield* pollWithTimeout(
          Effect.promise(() => lines(marker)).pipe(Effect.map((items) => (items.length ? items : undefined))),
          "the first WorktreeSetup run did not start",
          "10 seconds",
        )
        // The second request joins the running hooks; cancelling the first one kills them.
        const second = yield* KiloHookWorktree.dispatch(input).pipe(Effect.forkChild)
        yield* Effect.sleep("200 millis")
        yield* Fiber.interrupt(first)
        expect(yield* Fiber.join(second)).toEqual({ blocked: false })
        // Two runs started and only the second finished: the cancelled one was killed.
        const inputs = yield* Effect.promise(() => lines(marker))
        expect(inputs.map((item) => (item.done ? "done" : item.hook_event_name))).toEqual([
          "WorktreeSetup",
          "WorktreeSetup",
          "done",
        ])
      }),
    hooks((root) => {
      const marker = JSON.stringify(markerFor(root, "retry"))
      const done = `setTimeout(() => fs.appendFileSync(${marker}, JSON.stringify({ done: true }) + '\\n'), 1500)`
      return { WorktreeSetup: [{ hooks: [record(markerFor(root, "retry"), done)] }] }
    }),
    30_000,
  )

  it.instance(
    "runs WorktreeSetup with origin cli after the CLI creates a worktree",
    () =>
      Effect.gen(function* () {
        const root = (yield* TestInstance).directory
        const marker = markerFor(root, "cli-setup")
        yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(marker, { force: true })))
        const svc = yield* Worktree.Service
        const info = yield* svc.create({ name: `hooks-${Date.now().toString(36)}` })
        yield* Effect.addFinalizer(() => svc.remove({ directory: info.directory }).pipe(Effect.ignore))
        const inputs = yield* pollWithTimeout(
          Effect.promise(() => lines(marker)).pipe(Effect.map((items) => (items.length ? items : undefined))),
          "WorktreeSetup did not run for the CLI worktree",
          "20 seconds",
        )
        expect(inputs).toEqual([
          expect.objectContaining({
            hook_event_name: "WorktreeSetup",
            worktree_path: info.directory,
            repo_path: root,
            origin: "cli",
            setup_script: "none",
            env: { WORKTREE_PATH: info.directory, REPO_PATH: root },
          }),
        ])
        yield* Effect.promise(() => $`git worktree list`.cwd(root).quiet())
      }),
    hooks((root) => ({ WorktreeSetup: [{ matcher: "cli", hooks: [record(markerFor(root, "cli-setup"))] }] })),
    30_000,
  )
})
