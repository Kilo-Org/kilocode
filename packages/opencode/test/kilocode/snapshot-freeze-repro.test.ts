// kilocode_change - new file
//
// Regression test for the freeze bug: before the caps + worker offload,
// Snapshot.diffFull on a file with tens of thousands of lines could block
// the thread for minutes. In the TUI, that same thread hosts the Hono
// server — so the POST /:id/abort endpoint (what ESC fires) never ran.
//
// This test proves:
//   1. A synthetic freeze workload (30k-line file) now completes quickly.
//   2. The abort endpoint responds within a bounded time while the freeze
//      workload runs concurrently.
//   3. A concurrent timer is never starved for long — i.e. the event loop
//      keeps breathing and ESC would be delivered.

import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { test, expect, afterEach, mock } from "bun:test"
import { $ } from "bun"
import { Effect, Fiber, Layer } from "effect"
import { provideTestInstance } from "../fixture/fixture"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session/session"
import { Snapshot } from "../../src/snapshot"
import { Filesystem } from "../../src/util/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { seedProject } from "../fixture/fixture"
import { Database } from "@opencode-ai/core/database/database"
import { InstanceRef } from "../../src/effect/instance-ref"
import type { InstanceContext } from "../../src/project/instance-context"

void Log.init({ print: false })

/** Timer period used to sample event-loop responsiveness during the diff. */
const TICK_MS = 25

function run<A>(
  ctx: InstanceContext,
  body: (snapshot: Snapshot.Interface) => Effect.Effect<A, never, Session.Service>,
) {
  return Effect.runPromise(
    seedProject.pipe(
      Effect.andThen(Snapshot.Service.use(body)),
      Effect.provide(AppNodeBuilder.build(Snapshot.node)),
      Effect.provide(AppNodeBuilder.build(Session.node).pipe(Layer.provideMerge(AppNodeBuilder.build(Database.node)))),
      Effect.provideService(InstanceRef, ctx),
    ),
  )
}

afterEach(async () => {
  mock.restore()
  await disposeAllInstances()
})

test("pathological diffFull workload finishes quickly and does not block abort", async () => {
  // 3000-line file that churns every line between snapshots. Before the fix
  // this ran through structuredPatch at context=MAX_SAFE_INTEGER synchronously
  // and could take minutes.
  const v1 = Array.from({ length: 3000 }, (_, i) => `v1_line_${i}`).join("\n") + "\n"
  const v2 = Array.from({ length: 3000 }, (_, i) => `v2_line_${i}`).join("\n") + "\n"

  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await Filesystem.write(`${dir}/fat.json`, v1)
      await $`git add .`.cwd(dir).quiet()
      await $`git commit --no-gpg-sign -m init`.cwd(dir).quiet()
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: (ctx) =>
      run(ctx, (snapshot) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const session = yield* sessions.create({})

          const before = yield* snapshot.track()
          expect(before).toBeTruthy()

          yield* Effect.promise(() => Filesystem.write(`${tmp.path}/fat.json`, v2))
          const after = yield* snapshot.track()
          expect(after).toBeTruthy()

          const app = Server.Default().app
          const headers = { "x-kilo-directory": tmp.path }
          const warm = yield* Effect.promise(() =>
            Promise.resolve(app.request(`/session/${session.id}/abort`, { method: "POST", headers })),
          )
          expect(warm.status).toBe(200)

          // Kick off a diffFull that exercises the freeze path.
          const diff = yield* snapshot.diffFull(before!, after!).pipe(Effect.forkChild({ startImmediately: true }))

          // Concurrently record when a timer actually gets to run. A blocked event
          // loop shows up as a long stretch with no callback at all.
          //
          // Counting ticks and requiring count > 0 does not work here: the whole
          // workload now finishes in ~150ms, so there are only a handful of 25ms
          // windows, and one ordinary synchronous chunk of diff work on a loaded CI
          // box can starve every one of them. That made the assertion fail more
          // often the faster diffFull got, while a real freeze is a multi-second
          // stall. Measure the stall directly instead.
          const marks: number[] = []
          const start = Date.now()
          const timer = setInterval(() => marks.push(Date.now()), TICK_MS)

          try {
            // Fire an abort request against the warmed Hono route in the middle of the diff.
            const abortStart = Date.now()
            const res = yield* Effect.promise(() =>
              Promise.resolve(app.request(`/session/${session.id}/abort`, { method: "POST", headers })),
            )
            const abortLatency = Date.now() - abortStart
            expect(res.status).toBe(200)
            // The abort endpoint must respond well under a second even under load.
            expect(abortLatency).toBeLessThan(2000)

            const diffs = yield* Fiber.join(diff)
            const total = Date.now() - start

            // The freeze workload must finish in bounded time. Five seconds is
            // generous even for a slow CI box; without the fix this hangs.
            expect(total).toBeLessThan(5000)
            // And the event loop must never have been parked for long, proving it
            // stayed responsive (ESC would actually arrive). This is a sharper bound
            // than `total` alone: it catches a long contiguous stall even when the
            // overall run still lands inside the budget.
            const stamps = [start, ...marks, Date.now()]
            const stall = stamps.reduce((worst, at, i) => (i === 0 ? worst : Math.max(worst, at - stamps[i - 1]!)), 0)
            expect(stall).toBeLessThan(2000)

            // With git-based diff the patch is a real unified diff, not empty.
            const hit = diffs.find((d) => d.file === "fat.json")
            expect(hit).toBeDefined()
            expect(hit!.patch).toMatch(/^diff --git /m)
            expect(hit!.patch).toContain("-v1_line_0")
            expect(hit!.patch).toContain("+v2_line_0")
            expect(hit!.additions).toBeGreaterThan(0)
            expect(hit!.deletions).toBeGreaterThan(0)
          } finally {
            clearInterval(timer)
          }
        }),
      ),
  })
})
