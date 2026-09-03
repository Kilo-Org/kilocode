import { afterEach, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { AppRuntime } from "../../../src/effect/app-runtime"
import { InstanceRef } from "../../../src/effect/instance-ref"
import { Server } from "../../../src/server/server"
import { SessionPaths } from "../../../src/server/routes/instance/httpapi/groups/session"
import { Session } from "../../../src/session/session"
import { SessionRunState } from "../../../src/session/run-state"
import { SessionID } from "../../../src/session/schema"
import { withTimeout } from "../../../src/util/timeout"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, reloadTestInstance, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

const previous = {
  flag: Flag.KILO_SERVER_PASSWORD,
  env: process.env.KILO_SERVER_PASSWORD,
}

afterEach(async () => {
  Flag.KILO_SERVER_PASSWORD = previous.flag
  if (previous.env === undefined) delete process.env.KILO_SERVER_PASSWORD
  else process.env.KILO_SERVER_PASSWORD = previous.env
  await disposeAllInstances()
  await resetDatabase()
})

test("listener aborts shared parent and subagent runners", async () => {
  Flag.KILO_SERVER_PASSWORD = undefined
  delete process.env.KILO_SERVER_PASSWORD
  await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  const ctx = await reloadTestInstance({ directory: tmp.path })
  const tree = await AppRuntime.runPromise(
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({ title: "parent" })
      const child = yield* sessions.create({ title: "child", parentID: parent.id })
      const nested = yield* sessions.create({ title: "nested", parentID: child.id })
      return { parent, child, nested }
    }).pipe(Effect.provideService(InstanceRef, ctx)),
  )
  const started = {
    parent: Promise.withResolvers<void>(),
    child: Promise.withResolvers<void>(),
    nested: Promise.withResolvers<void>(),
  }
  const stopped = {
    parent: Promise.withResolvers<void>(),
    child: Promise.withResolvers<void>(),
    nested: Promise.withResolvers<void>(),
  }
  const run = (id: SessionID, ready: () => void, done: () => void) =>
    AppRuntime.runPromise(
      SessionRunState.Service.use((state) =>
        state.ensureRunning(
          id,
          Effect.interrupt,
          Effect.sync(ready).pipe(Effect.andThen(Effect.never), Effect.ensuring(Effect.sync(done))),
        ),
      ).pipe(Effect.provideService(InstanceRef, ctx)),
    ).catch(() => undefined)
  const running = [
    run(tree.parent.id, started.parent.resolve, stopped.parent.resolve),
    run(tree.child.id, started.child.resolve, stopped.child.resolve),
    run(tree.nested.id, started.nested.resolve, stopped.nested.resolve),
  ]

  try {
    await Promise.all([
      withTimeout(started.parent.promise, 5_000, "timed out waiting for shared parent session"),
      withTimeout(started.child.promise, 5_000, "timed out waiting for shared subagent session"),
      withTimeout(started.nested.promise, 5_000, "timed out waiting for nested shared subagent session"),
    ])
    const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
    try {
      const response = await fetch(new URL(SessionPaths.abort.replace(":sessionID", tree.parent.id), listener.url), {
        method: "POST",
        headers: { "x-kilo-directory": tmp.path },
      })
      expect(response.status).toBe(200)
      await Promise.all([
        withTimeout(stopped.parent.promise, 5_000, "listener did not interrupt the shared parent session"),
        withTimeout(stopped.child.promise, 5_000, "listener did not interrupt the shared subagent session"),
        withTimeout(stopped.nested.promise, 5_000, "listener did not interrupt the nested shared subagent session"),
      ])
    } finally {
      await withTimeout(listener.stop(true), 10_000, "timed out cleaning up shared-runtime listener")
    }
  } finally {
    await AppRuntime.runPromise(
      SessionRunState.Service.use((state) =>
        Effect.forEach([tree.parent.id, tree.child.id, tree.nested.id], (sessionID) => state.cancel(sessionID), {
          concurrency: "unbounded",
          discard: true,
        }),
      ).pipe(Effect.provideService(InstanceRef, ctx)),
    ).catch(() => undefined)
    await Promise.all(running)
  }
}, 20_000)
