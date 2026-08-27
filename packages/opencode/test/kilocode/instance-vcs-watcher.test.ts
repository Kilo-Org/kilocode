import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Deferred, Effect } from "effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Git } from "../../src/git"
import { Vcs } from "../../src/project/vcs"
import { TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const layer = LayerNode.compile(LayerNode.group([Vcs.node, Git.node, EventV2Bridge.node, CrossSpawnSpawner.node]))
const it = testEffect(layer)

const git = Effect.fn("VcsWatcherTest.git")(function* (cwd: string, args: string[]) {
  const result = yield* Git.Service.use((git) => git.run(args, { cwd }))
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString("utf8")}`)
})

describe("Vcs without native watchers", () => {
  it.instance(
    "branch reads the current git branch after a switch",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const vcs = yield* Vcs.Service
        yield* vcs.branch()
        const branch = `fresh-${Math.random().toString(36).slice(2)}`
        yield* git(test.directory, ["branch", branch])
        yield* git(test.directory, ["switch", branch])

        expect(yield* vcs.branch()).toBe(branch)
      }),
    { git: true },
  )

  it.instance(
    "branch diff reads the current branch after a switch",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const vcs = yield* Vcs.Service
        yield* git(test.directory, ["branch", "-M", "main"])
        expect(yield* vcs.branch()).toBe("main")

        const branch = `diff-${Math.random().toString(36).slice(2)}`
        yield* git(test.directory, ["switch", "-c", branch])
        yield* Effect.promise(() => Bun.write(`${test.directory}/branch.txt`, "branch\n"))
        yield* git(test.directory, ["add", "branch.txt"])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "branch change"])

        const diff = yield* vcs.diff("branch")
        expect(diff.find((item) => item.file === "branch.txt")).toMatchObject({ status: "added" })
      }),
    { git: true },
  )

  it.instance(
    "publishes a branch update when a fresh branch read changes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const vcs = yield* Vcs.Service
        const events = yield* EventV2Bridge.Service
        yield* vcs.branch()
        const branch = `event-${Math.random().toString(36).slice(2)}`
        yield* git(test.directory, ["branch", branch])

        const updated = yield* Deferred.make<string | undefined>()
        const off = yield* events.listen((event) => {
          if (event.type === Vcs.Event.BranchUpdated.type)
            Deferred.doneUnsafe(
              updated,
              Effect.succeed((event.data as typeof Vcs.Event.BranchUpdated.data.Type).branch),
            )
          return Effect.void
        })
        yield* Effect.addFinalizer(() => off)
        yield* git(test.directory, ["switch", branch])

        expect(yield* vcs.branch()).toBe(branch)
        expect(yield* awaitWithTimeout(Deferred.await(updated), "timed out waiting for branch update")).toBe(branch)
      }),
    { git: true },
  )
})
