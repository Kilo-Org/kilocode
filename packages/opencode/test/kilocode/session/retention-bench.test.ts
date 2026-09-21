import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "../../../src/config/config"
import { Session } from "../../../src/session/session"
import { KiloSessionRetention } from "../../../src/kilocode/session/retention"
import { testEffect } from "../../lib/effect"

const it = testEffect(LayerNode.compile(Database.node))
const bench = process.env.KILO_RETENTION_BENCH === "1" ? it.live : it.live.skip
const enabled = Layer.merge(
  Layer.mock(Config.Service, { get: () => Effect.succeed({ retention: { enabled: true, maxAgeDays: 30 } }) }),
  Layer.mock(Session.Service, { remove: () => Effect.die("benchmark must not delete sessions") }),
)

bench(
  "synthetic retention benchmark with 8063 sessions and 2000000 parts",
  () =>
    Effect.gen(function* () {
      expect(Database.path()).toBe(":memory:")
      const { db } = yield* Database.Service
      const now = Date.now()
      const old = now - 40 * KiloSessionRetention.DAY_MS
      yield* db
        .run(
          sql`INSERT INTO project (id,worktree,time_created,time_updated,sandboxes) VALUES ('proj_bench','/tmp/retention-bench',${now},${now},'[]')`,
        )
        .pipe(Effect.orDie)
      yield* db
        .run(
          sql`WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<8062)
      INSERT INTO session (id,project_id,slug,directory,title,version,time_created,time_updated)
      SELECT 'ses_bench_'||x,'proj_bench','bench','/tmp/retention-bench','bench','test',${old},${now} FROM n`,
        )
        .pipe(Effect.orDie)
      yield* db
        .run(
          sql`INSERT INTO message (id,session_id,time_created,time_updated,data)
      SELECT 'msg_'||id,id,${old},${old},'{}' FROM session`,
        )
        .pipe(Effect.orDie)
      yield* db
        .run(
          sql`WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<1999999)
      INSERT INTO part (id,message_id,session_id,time_created,time_updated,data)
      SELECT 'prt_bench_'||x,'msg_ses_bench_'||(x%8063),'ses_bench_'||(x%8063),${old},${old},
      '{"type":"text","text":"synthetic history payload for retention benchmark, not user data"}' FROM n`,
        )
        .pipe(Effect.orDie)
      for (const candidates of [0, 64]) {
        if (candidates) {
          yield* db
            .run(sql`UPDATE session SET time_updated=${old} WHERE CAST(substr(id,11) AS INTEGER)<${candidates}`)
            .pipe(Effect.orDie)
          yield* db
            .run(sql`UPDATE part SET time_updated=${now} WHERE CAST(substr(id,11) AS INTEGER)<${candidates}`)
            .pipe(Effect.orDie)
        }
        const samples: Array<{ elapsed: number; blocked: number; reported: number }> = []
        for (let run = 0; run < 5; run++) {
          let tick = performance.now()
          let blocked = 0
          const timer = yield* Effect.acquireRelease(
            Effect.sync(() =>
              setInterval(() => {
                const now = performance.now()
                blocked = Math.max(blocked, now - tick)
                tick = now
              }, 1),
            ),
            (timer) => Effect.sync(() => clearInterval(timer)),
          )
          const start = performance.now()
          const outcome = yield* KiloSessionRetention.run({ force: true }).pipe(Effect.provide(enabled))
          const elapsed = performance.now() - start
          yield* Effect.promise(() => Bun.sleep(2))
          clearInterval(timer)
          expect(outcome.ran).toBe(true)
          if (!outcome.ran) continue
          expect(outcome.result.deleted).toBe(0)
          expect(outcome.result.failed).toBe(0)
          expect(outcome.result.skippedActive).toBe(candidates)
          samples.push({ elapsed, blocked, reported: outcome.result.durationMs })
        }
        console.log(JSON.stringify({ candidates, sessions: 8063, parts: 2000000, samples }))
      }
    }),
  120_000,
)
