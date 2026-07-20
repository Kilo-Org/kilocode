import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, Scope } from "effect"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { Reference } from "@opencode-ai/core/reference"
import { Repository } from "@opencode-ai/core/repository"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { EventV2 } from "@opencode-ai/core/event"
import { it } from "./lib/effect"

const cache = Layer.mock(RepositoryCache.Service, {
  ensure: () => Effect.die("unexpected Git materialization"),
})
// kilocode_change start
const events = Layer.mock(EventV2.Service)({
  publish: (definition, data) =>
    Effect.succeed({ id: EventV2.ID.make("evt_reference_test"), type: definition.type, data }),
})
// kilocode_change end

describe("Reference", () => {
  it.effect("registers normalized sources for the owning scope", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const scope = yield* Scope.make()
      const update = yield* references.transform().pipe(Effect.provideService(Scope.Scope, scope))
      const path = AbsolutePath.make("/docs")
      const source = new Reference.LocalSource({
        type: "local",
        path,
        description: "Use for API documentation",
        hidden: true,
      })
      yield* update((editor) => editor.add("docs", source))

      expect(yield* references.list()).toEqual([
        new Reference.Info({ name: "docs", path, description: "Use for API documentation", hidden: true, source }),
      ])

      yield* Scope.close(scope, Exit.void)
      expect(yield* references.list()).toEqual([])
    }).pipe(
      Effect.provide(Reference.layer),
      Effect.provide(cache),
      Effect.provide(events), // kilocode_change
      Effect.provide(Global.defaultLayer),
    ),
  )

  it.effect("derives Git paths without exposing cache operations", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const update = yield* references.transform()
      const repository = Repository.parseRemote("owner/repo")
      const source = new Reference.GitSource({ type: "git", repository: "owner/repo", branch: "main" })
      yield* update((editor) => editor.add("sdk", source))

      expect(yield* references.list()).toEqual([
        new Reference.Info({
          name: "sdk",
          path: AbsolutePath.make(Repository.cachePath(Global.Path.repos, repository)),
          source,
        }),
      ])
    }).pipe(
      Effect.scoped,
      Effect.provide(Reference.layer),
      Effect.provide(cache),
      Effect.provide(events), // kilocode_change
      Effect.provide(Global.defaultLayer),
    ),
  )

  it.effect("preserves configured Git descriptions", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const update = yield* references.transform()
      const repository = Repository.parseRemote("owner/repo")
      const source = new Reference.GitSource({
        type: "git",
        repository: "owner/repo",
        description: "Use for SDK implementation details",
      })
      yield* update((editor) => editor.add("sdk", source))

      expect(yield* references.list()).toEqual([
        new Reference.Info({
          name: "sdk",
          path: AbsolutePath.make(Repository.cachePath(Global.Path.repos, repository)),
          description: "Use for SDK implementation details",
          source,
        }),
      ])
    }).pipe(
      Effect.scoped,
      Effect.provide(Reference.layer),
      Effect.provide(cache),
      // kilocode_change start
      Effect.provide(events),
      Effect.provide(Global.defaultLayer),
    ),
  )

  it.effect("replaces sources without a scoped transform", () =>
    Effect.gen(function* () {
      const references = yield* Reference.Service
      const update = yield* references.transform()
      const stale = new Reference.LocalSource({ type: "local", path: AbsolutePath.make("/stale") })
      const current = new Reference.LocalSource({ type: "local", path: AbsolutePath.make("/current") })
      yield* update((editor) => editor.add("stale", stale))
  // kilocode_change end

      yield* references.replace([["current", current]]) // kilocode_change

      // kilocode_change start
      expect(yield* references.list()).toEqual([
        new Reference.Info({ name: "current", path: AbsolutePath.make("/current"), source: current }),
      ])
    }).pipe(
      Effect.scoped,
      Effect.provide(Reference.layer),
      Effect.provide(cache),
      Effect.provide(events),
      // kilocode_change end
      Effect.provide(Global.defaultLayer),
    ),
  )
})
