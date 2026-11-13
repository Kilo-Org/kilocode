import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Environment } from "@opencode/core/environment/index"
import { Formatter } from "@opencode/core/formatter"
import { FileMutation } from "@opencode/core/file-mutation"
import { Location } from "@opencode/core/location"
import { FileAccess } from "@opencode/core/file-access"
import { AbsolutePath } from "@opencode/core/schema"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { PatchTool } from "@opencode/core/tool/plugin/patch"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { transformEnvironmentFiles } from "../fixture/environment"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { permissionLayer } from "../lib/permission"
import { toolIdentity, executeTool, registerToolPlugin } from "../lib/tool"

const sessionID = Session.ID.make("ses_patch_move_test")

const patchToolNode = makeLocationNode({
  name: "test/kilocode/patch-move",
  layer: Layer.effectDiscard(registerToolPlugin(PatchTool.Plugin)),
  deps: [
    Tool.node,
    FileAccess.node,
    FileMutation.node,
    Environment.node,
    Formatter.node,
    Location.node,
    Permission.node,
  ],
})

const permission = permissionLayer({ assert: () => Effect.void })
const formatter = Layer.mock(Formatter.Service, { file: () => Effect.succeed(false) })

const withTool = <A, E, R>(directory: string, body: (registry: Tool.Interface) => Effect.Effect<A, E, R>) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(
      location({ directory: AbsolutePath.make(directory) }, { projectDirectory: AbsolutePath.make(directory) }),
    ),
  )
  return Effect.gen(function* () {
    return yield* body(yield* Tool.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Tool.node, FileAccess.node, FileMutation.node, patchToolNode]), [
        Environment.node.replace(transformEnvironmentFiles()),
        Location.node.replace(activeLocation),
        Formatter.node.replace(formatter),
        Permission.node.replace(permission),
      ]),
    ),
  )
}

const call = (patchText: string) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: "call-patch-move", name: "patch", input: { patchText } },
})

const it = testEffect(Layer.empty)

describe("patch tool move", () => {
  it.live("marks a renamed file as moved", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            const source = path.join(tmp.path, "old", "name.txt")
            yield* Effect.promise(() => fs.mkdir(path.dirname(source), { recursive: true }))
            yield* Effect.promise(() => fs.writeFile(source, "old content\n"))
            const settled = yield* executeTool(
              registry,
              call(
                "*** Begin Patch\n*** Update File: old/name.txt\n*** Move to: renamed/dir/name.txt\n@@\n-old content\n+new content\n*** End Patch",
              ),
            )
            expect(settled.status).toBe("completed")
            if (settled.status !== "completed") return
            expect(settled.output.files).toMatchObject([
              { file: "renamed/dir/name.txt", status: "modified", moved: true },
            ])
          }),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("does not mark a content update as moved", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            const target = path.join(tmp.path, "name.txt")
            yield* Effect.promise(() => fs.writeFile(target, "old content\n"))
            const settled = yield* executeTool(
              registry,
              call("*** Begin Patch\n*** Update File: name.txt\n@@\n-old content\n+new content\n*** End Patch"),
            )
            expect(settled.status).toBe("completed")
            if (settled.status !== "completed") return
            expect(settled.output.files[0].moved).toBeUndefined()
          }),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("does not mark a self-move as moved", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            const target = path.join(tmp.path, "name.txt")
            yield* Effect.promise(() => fs.writeFile(target, "old content\n"))
            const settled = yield* executeTool(
              registry,
              call(
                "*** Begin Patch\n*** Update File: name.txt\n*** Move to: ./name.txt\n@@\n-old content\n+new content\n*** End Patch",
              ),
            )
            expect(settled.status).toBe("completed")
            if (settled.status !== "completed") return
            expect(settled.output.files[0].moved).toBeUndefined()
          }),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
