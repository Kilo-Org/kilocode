import { test, expect } from "bun:test"
import { $ } from "bun"
import { Effect } from "effect"
import { Snapshot } from "../../src/snapshot"
import { provideTestInstance } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

async function bootstrap() {
  return tmpdir({
    git: true,
    init: async (dir) => {
      await Filesystem.write(`${dir}/a.txt`, "A")
      await Filesystem.write(`${dir}/b.txt`, "B")
      await $`git add .`.cwd(dir).quiet()
      await $`git commit --no-gpg-sign -m init`.cwd(dir).quiet()
    },
  })
}

function run<A>(body: (snapshot: Snapshot.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(Snapshot.Service.use(body).pipe(Effect.provide(Snapshot.defaultLayer)))
}

test("diffFull returns cached result for same hash pair", async () => {
  await using tmp = await bootstrap()
  await provideTestInstance({
    directory: tmp.path,
    fn: () =>
      run((snapshot) =>
        Effect.gen(function* () {
          const before = yield* snapshot.track()
          expect(before).toBeTruthy()

          yield* Effect.promise(() => Filesystem.write(`${tmp.path}/a.txt`, "MODIFIED"))
          const after = yield* snapshot.track()
          expect(after).toBeTruthy()
          expect(after).not.toBe(before)

          const first = yield* snapshot.diffFull(before!, after!)
          const second = yield* snapshot.diffFull(before!, after!)

          // Should be the exact same array reference (cached)
          expect(second).toBe(first)
          expect(first.length).toBeGreaterThan(0)
        }),
      ),
  })
})

test("diffFull returns empty array when from === to", async () => {
  await using tmp = await bootstrap()
  await provideTestInstance({
    directory: tmp.path,
    fn: () =>
      run((snapshot) =>
        Effect.gen(function* () {
          const hash = yield* snapshot.track()
          expect(hash).toBeTruthy()

          const result = yield* snapshot.diffFull(hash!, hash!)
          expect(result).toEqual([])
        }),
      ),
  })
})

test("diffFull concurrent calls for same pair share one result", async () => {
  await using tmp = await bootstrap()
  await provideTestInstance({
    directory: tmp.path,
    fn: () =>
      run((snapshot) =>
        Effect.gen(function* () {
          const before = yield* snapshot.track()
          expect(before).toBeTruthy()

          yield* Effect.promise(() => Filesystem.write(`${tmp.path}/a.txt`, "CONCURRENT"))
          const after = yield* snapshot.track()
          expect(after).toBeTruthy()

          // Fire multiple concurrent calls, they should all resolve to the same object.
          const results = yield* Effect.all(
            [
              snapshot.diffFull(before!, after!),
              snapshot.diffFull(before!, after!),
              snapshot.diffFull(before!, after!),
            ],
            { concurrency: "unbounded" },
          )

          expect(results[0]).toBe(results[1])
          expect(results[1]).toBe(results[2])
          expect(results[0].length).toBeGreaterThan(0)
        }),
      ),
  })
})
