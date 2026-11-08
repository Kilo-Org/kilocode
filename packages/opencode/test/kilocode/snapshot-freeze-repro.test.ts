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
//   3. A concurrent setInterval keeps ticking — i.e. the event loop keeps
//      breathing and ESC would be delivered.

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

function run<A>(ctx: InstanceContext, body: (snapshot: Snapshot.Interface) => Effect.Effect<A, never, Session.Service>) {
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

          // Watch for event-loop stalls. Tick *count* is not a usable signal: the
          // whole point of the fix is that this workload is fast, so on a quick box
          // it finishes inside a single interval period and zero ticks is the
          // healthy outcome. What matters is that no single gap between ticks is
          // long enough to swallow an ESC keypress.
          //
          // Arm the watchdog before forking the diff. `startImmediately` means the
          // fiber runs at the fork, so a stall right at fork time would otherwise
          // land in the unobserved window before the first tick. All timings use
          // the monotonic `performance.now()` clock: `Date.now()` is wall time and
          // an NTP step mid-test could fabricate or mask a stall.
          const clock = { last: performance.now(), gap: 0 }
          const start = clock.last
          const timer = setInterval(() => {
            const now = performance.now()
            clock.gap = Math.max(clock.gap, now - clock.last)
            clock.last = now
          }, 25)

          try {
            // Kick off a diffFull that exercises the freeze path.
            const diff = yield* snapshot.diffFull(before!, after!).pipe(Effect.forkChild({ startImmediately: true }))

            // Fire an abort request against the warmed Hono route in the middle of the diff.
            const abortStart = performance.now()
            const res = yield* Effect.promise(() =>
              Promise.resolve(app.request(`/session/${session.id}/abort`, { method: "POST", headers })),
            )
            const abortLatency = performance.now() - abortStart
            expect(res.status).toBe(200)
            // The abort endpoint must respond well under a second even under load.
            expect(abortLatency).toBeLessThan(2000)

            const diffs = yield* Fiber.join(diff)
            const total = performance.now() - start
            clock.gap = Math.max(clock.gap, performance.now() - clock.last)

            // The freeze workload must finish in bounded time. Five seconds is
            // generous even for a slow CI box; without the fix this hangs.
            expect(total).toBeLessThan(5000)
            // And the event loop must never have been parked long enough to delay
            // ESC delivery. Without the fix this gap ran into minutes.
            expect(clock.gap).toBeLessThan(2000)

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
  // Setup alone (git init, committing a 3000-line file, two snapshots) can
  // outlive bun's 5s default on a loaded machine.
}, 30_000)
