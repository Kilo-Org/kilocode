import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Git } from "@opencode-ai/core/git"
import { Global } from "@opencode-ai/core/global"
import { Reference } from "@opencode-ai/core/reference"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { commit, git, gitRemote } from "../fixture/git"
import { tmpdir } from "../fixture/tmpdir"
import { it } from "../lib/effect"

const events = Layer.mock(EventV2.Service)({
  publish: (definition, data) =>
    Effect.succeed({
      id: EventV2.ID.make("evt_reference_test"),
      type: definition.type,
      data,
    }),
})

describe("Kilo reference compatibility", () => {
  it.live("materializes and refreshes configured Git references", () =>
    withRemote((fixture) => {
      const global = Global.layerWith({
        repos: path.join(fixture.root, "repos"),
        state: path.join(fixture.root, "state"),
      })
      const deps = Layer.mergeAll(global, FSUtil.defaultLayer)
      const cache = RepositoryCache.layer.pipe(
        Layer.provide(EffectFlock.layer.pipe(Layer.provide(deps))),
        Layer.provide(Git.defaultLayer),
        Layer.provide(deps),
      )
      const layer = Reference.layer.pipe(
        Layer.provide(cache),
        Layer.provide(events),
        Layer.provide(global),
      )

      return Effect.gen(function* () {
        const previous = process.env.KILO_REPO_CLONE_GITHUB_BASE_URL
        process.env.KILO_REPO_CLONE_GITHUB_BASE_URL = pathToFileURL(fixture.root + path.sep).href
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (previous === undefined) delete process.env.KILO_REPO_CLONE_GITHUB_BASE_URL
            else process.env.KILO_REPO_CLONE_GITHUB_BASE_URL = previous
          }),
        )

        const references = yield* Reference.Service
        const update = yield* references.transform()
        const source = new Reference.GitSource({ type: "git", repository: "owner/repo", branch: "main" })
        const file = path.join(fixture.root, "repos", "github.com", "owner", "repo", "README.md")

        yield* update((editor) => editor.add("docs", source))
        yield* Effect.promise(() => content(file, "one\n"))
        expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("one\n")

        yield* Effect.promise(() => commit(fixture.source, "two\n", "update"))
        yield* update((editor) => editor.add("docs", source))
        yield* Effect.promise(() => content(file, "two\n"))
        expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("two\n")
      }).pipe(Effect.scoped, Effect.provide(layer))
    }),
  )
})

async function content(file: string, expected: string, retries = 100): Promise<void> {
  const value = await fs.readFile(file, "utf8").catch(() => undefined)
  if (value === expected) return
  if (retries === 0) throw new Error(`Timed out waiting for ${file} to contain ${JSON.stringify(expected)}`)
  await Bun.sleep(20)
  return content(file, expected, retries - 1)
}

function withRemote<A, E, R>(body: (fixture: { root: string; source: string }) => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.promise(async () => {
      const root = await tmpdir()
      const fixture = await gitRemote(root.path)
      const owner = path.join(root.path, "owner")
      const remote = path.join(owner, "repo.git")
      await fs.mkdir(owner)
      await fs.rename(path.join(root.path, "origin.git"), remote)
      await git(fixture.source, "remote", "set-url", "origin", pathToFileURL(remote).href)
      return { tmp: root, root: root.path, source: fixture.source }
    }),
    (fixture) => body(fixture),
    (fixture) => Effect.promise(() => fixture.tmp[Symbol.asyncDispose]()),
  )
}
