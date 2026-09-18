import { describe, expect } from "bun:test"
import { Context, Effect } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { ProviderUsage } from "../src/kilocode/provider-usage"
import { Location } from "../src/location"
import { LocationServiceMap } from "../src/location-services"
import { AbsolutePath } from "../src/schema"
import { WorkspaceV2 } from "../src/workspace"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LocationServiceMap.node))

describe("ProviderUsage location lifecycle", () => {
  it.live("reuses the same location and isolates workspace-qualified locations", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.scoped(
          Effect.gen(function* () {
            const locations = yield* LocationServiceMap.Service
            const directory = AbsolutePath.make(dir.path)
            const first = Location.Ref.make({ directory, workspaceID: WorkspaceV2.ID.make("wrk_workspace_a") })
            const same = Location.Ref.make({ directory, workspaceID: WorkspaceV2.ID.make("wrk_workspace_a") })
            const second = Location.Ref.make({ directory, workspaceID: WorkspaceV2.ID.make("wrk_workspace_b") })
            const firstService = Context.get(yield* locations.contextEffect(first), ProviderUsage.Service)

            expect(Context.get(yield* locations.contextEffect(same), ProviderUsage.Service)).toBe(firstService)
            expect(Context.get(yield* locations.contextEffect(second), ProviderUsage.Service)).not.toBe(firstService)
          }),
        ),
      ),
    ),
  )
})
