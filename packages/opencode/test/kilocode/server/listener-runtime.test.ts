import { afterEach, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { AppRuntime } from "../../../src/effect/app-runtime"
import { InstanceRef } from "../../../src/effect/instance-ref"
import { Server } from "../../../src/server/server"
import { SessionPaths } from "../../../src/server/routes/instance/httpapi/groups/session"
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

test("listener aborts shared session runners", async () => {
  Flag.KILO_SERVER_PASSWORD = undefined
  delete process.env.KILO_SERVER_PASSWORD
  await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  const ctx = await reloadTestInstance({ directory: tmp.path })
  const sessionID = SessionID.descending()
  const started = Promise.withResolvers<void>()
  const stopped = Promise.withResolvers<void>()
  const running = AppRuntime.runPromise(
    SessionRunState.Service.use((state) =>
      state.ensureRunning(
        sessionID,
        Effect.interrupt,
        Effect.sync(started.resolve).pipe(Effect.andThen(Effect.never), Effect.ensuring(Effect.sync(stopped.resolve))),
      ),
    ).pipe(Effect.provideService(InstanceRef, ctx)),
  ).catch(() => undefined)

  try {
    await withTimeout(started.promise, 5_000, "timed out waiting for shared session")
    const listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
    try {
      const response = await fetch(new URL(SessionPaths.abort.replace(":sessionID", sessionID), listener.url), {
        method: "POST",
        headers: { "x-kilo-directory": tmp.path },
      })
      expect(response.status).toBe(200)
      await withTimeout(stopped.promise, 5_000, "listener did not interrupt the shared session")
    } finally {
      await withTimeout(listener.stop(true), 10_000, "timed out cleaning up shared-runtime listener")
    }
  } finally {
    await AppRuntime.runPromise(
      SessionRunState.Service.use((state) => state.cancel(sessionID)).pipe(Effect.provideService(InstanceRef, ctx)),
    ).catch(() => undefined)
    await running
  }
}, 20_000)
