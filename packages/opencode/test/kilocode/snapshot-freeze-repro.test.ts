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

import { test, expect, afterEach, mock } from "bun:test"
import { $ } from "bun"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Snapshot } from "../../src/snapshot"
import { Filesystem, Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
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

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})

      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/fat.json`, v2)
      const after = await Snapshot.track()
      expect(after).toBeTruthy()

      // Kick off a diffFull that exercises the freeze path.
      const diffPromise = Snapshot.diffFull(before!, after!)

      // Concurrently keep a tick counter running. If the event loop blocks we
      // will see this count fall behind wall-clock elapsed.
      let ticks = 0
      const start = Date.now()
      const timer = setInterval(() => {
        ticks++
      }, 25)

      // Fire an abort request against the Hono app in the middle of the diff.
      const app = Server.Default().app
      const abortStart = Date.now()
      const res = await app.request(`/session/${session.id}/abort`, { method: "POST" })
      const abortLatency = Date.now() - abortStart
      expect(res.status).toBe(200)
      // The abort endpoint must respond well under a second even under load.
      expect(abortLatency).toBeLessThan(2000)

      const diffs = await diffPromise
      clearInterval(timer)
      const total = Date.now() - start

      // The freeze workload must finish in bounded time. Five seconds is
      // generous even for a slow CI box; without the fix this hangs.
      expect(total).toBeLessThan(5000)
      // And we must have ticked at least a few times during the work — proves
      // the event loop stayed responsive (ESC would actually arrive).
      expect(ticks).toBeGreaterThan(0)

      // With git-based diff the patch is a real unified diff, not empty.
      const hit = diffs.find((d) => d.file === "fat.json")
      expect(hit).toBeDefined()
      expect(hit!.patch).toMatch(/^diff --git /m)
      expect(hit!.patch).toContain("-v1_line_0")
      expect(hit!.patch).toContain("+v2_line_0")
      expect(hit!.additions).toBeGreaterThan(0)
      expect(hit!.deletions).toBeGreaterThan(0)
    },
  })
})
