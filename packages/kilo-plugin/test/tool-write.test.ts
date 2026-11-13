import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { FileMutation } from "@opencode/core/file-mutation"
import { FileWrite } from "@opencode/core/file-write"
import { Formatter } from "@opencode/core/formatter"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { WriteTool } from "@opencode/core/tool/plugin/write"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { transformEnvironmentFiles } from "../../core/test/fixture/environment"
import { location } from "../../core/test/fixture/location"
import { withTempDir } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { permissionLayer } from "../../core/test/lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "../../core/test/lib/tool"
import { KiloWriteToolPlugin } from "../src/tool-write"

const sessionID = Session.ID.make("ses_kilo_tool_write_test")

const node = (directory: string, worktree = directory) =>
  makeLocationNode({
    name: "test/kilo-tool-write-plugin",
    layer: Layer.effectDiscard(
      Effect.gen(function* () {
        yield* registerToolPlugin(WriteTool.Plugin)
        yield* registerToolPlugin(KiloWriteToolPlugin, {
          location: new Location.Info({
            directory: AbsolutePath.make(directory),
            project: {
              id: Project.ID.global,
              directory: AbsolutePath.make(worktree),
              canonical: AbsolutePath.make(worktree),
            },
          }),
        })
      }),
    ),
    deps: [Tool.node, FileWrite.node, FSUtil.node],
  })

const withTool = <A, E, R>(
  directory: string,
  formatFile: (target: string) => Effect.Effect<boolean>,
  body: (registry: Tool.Interface) => Effect.Effect<A, E, R>,
  worktree = directory,
) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of({
      ...location({ directory: AbsolutePath.make(directory) }),
      project: {
        id: Project.ID.global,
        directory: AbsolutePath.make(worktree),
        canonical: AbsolutePath.make(worktree),
      },
    }),
  )
  return Effect.gen(function* () {
    const registry = yield* Tool.Service
    return yield* body(registry)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Tool.node, FileAccess.node, FileMutation.node, node(directory, worktree)]), [
        Config.node.replace(Config.testLayer()),
        Environment.node.replace(transformEnvironmentFiles()),
        Location.node.replace(activeLocation),
        Formatter.node.replace(Layer.mock(Formatter.Service, { file: (target) => formatFile(target) })),
        Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
      ]),
    ),
  )
}

const call = (input: typeof WriteTool.Input.Type) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: "call-write", name: "write", input },
})

const it = testEffect(Layer.empty)

describe("Kilo write tool diff", () => {
  it.live("adds the diff of a new file to the result metadata", () =>
    withTempDir((tmp) => {
      return withTool(
        tmp.path,
        () => Effect.succeed(false),
        (registry) => executeTool(registry, call({ path: "src/new.txt", content: "created\n" })),
      ).pipe(
        Effect.tap((settled) =>
          Effect.sync(() => {
            expect(settled.metadata).toEqual({
              files: [
                expect.objectContaining({
                  file: "src/new.txt",
                  status: "added",
                  additions: 1,
                  deletions: 0,
                  patch: expect.stringContaining("+created"),
                }),
              ],
            })
          }),
        ),
      )
    }),
  )

  it.live("adds the diff of the formatted content, not the written content", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "formatted.txt")
      const format = (file: string) =>
        Effect.promise(async () => {
          await fs.writeFile(file, (await fs.readFile(file, "utf8")).toUpperCase())
          return true
        })
      return Effect.promise(() => fs.writeFile(target, "before\n")).pipe(
        Effect.andThen(
          withTool(tmp.path, format, (registry) =>
            executeTool(registry, call({ path: "formatted.txt", content: "format me\n" })),
          ),
        ),
        Effect.tap((settled) =>
          Effect.sync(() => {
            expect(settled.metadata).toEqual({
              files: [
                expect.objectContaining({
                  file: "formatted.txt",
                  status: "modified",
                  additions: 1,
                  deletions: 1,
                  patch: expect.stringMatching(/-before\n\+FORMAT ME\n/),
                }),
              ],
            })
          }),
        ),
      )
    }),
  )

  it.live("reports an empty diff when the write leaves the file unchanged", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "same.txt")
      return Effect.promise(() => fs.writeFile(target, "same\n")).pipe(
        Effect.andThen(
          withTool(
            tmp.path,
            () => Effect.succeed(false),
            (registry) => executeTool(registry, call({ path: "same.txt", content: "same\n" })),
          ),
        ),
        Effect.tap((settled) =>
          Effect.sync(() => {
            expect(settled.metadata).toEqual({
              files: [expect.objectContaining({ file: "same.txt", additions: 0, deletions: 0 })],
            })
          }),
        ),
      )
    }),
  )

  it.live("keeps the counts and drops the patch above the size limit", () =>
    withTempDir((tmp) =>
      withTool(
        tmp.path,
        () => Effect.succeed(false),
        (registry) => executeTool(registry, call({ path: "large.txt", content: "x".repeat(300_000) })),
      ).pipe(
        Effect.tap((settled) =>
          Effect.sync(() => {
            expect(settled.metadata).toEqual({
              files: [
                expect.objectContaining({ file: "large.txt", status: "added", additions: 1, deletions: 0, patch: "" }),
              ],
            })
          }),
        ),
      ),
    ),
  )

  it.live("leaves a write outside the Location without a diff", () =>
    withTempDir((active) =>
      withTempDir((outside) =>
        Effect.gen(function* () {
          const target = path.join(outside.path, "external.txt")
          yield* Effect.promise(() => fs.writeFile(target, "before\n"))
          const settled = yield* withTool(
            active.path,
            () => Effect.succeed(false),
            (registry) => executeTool(registry, call({ path: target, content: "after\n" })),
          )
          expect(settled.status).toBe("completed")
          expect(settled.metadata).toBeUndefined()
          expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("after\n")
        }),
      ),
    ),
  )

  it.live("reads the pre-write file through a leading tilde", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "tilde.txt")
      const fromHome = "~/" + path.relative(Global.Path.home, target).split(path.sep).join("/")
      return Effect.promise(() => fs.writeFile(target, "before\n")).pipe(
        Effect.andThen(
          withTool(tmp.path, () => Effect.succeed(false), (registry) =>
            executeTool(registry, call({ path: fromHome, content: "after\n" })),
          ),
        ),
        Effect.tap((settled) =>
          Effect.sync(() => {
            expect(settled.metadata).toEqual({
              files: [expect.objectContaining({ file: "tilde.txt", status: "modified", additions: 1, deletions: 1 })],
            })
          }),
        ),
      )
    }),
  )

  it.live("reads a file in the worktree outside the session directory", () =>
    withTempDir((root) =>
      Effect.gen(function* () {
        const session = path.join(root.path, "session")
        yield* Effect.promise(() => fs.mkdir(session))
        const target = path.join(root.path, "shared.txt")
        yield* Effect.promise(() => fs.writeFile(target, "before\n"))
        const settled = yield* withTool(
          session,
          () => Effect.succeed(false),
          (registry) => executeTool(registry, call({ path: "../shared.txt", content: "after\n" })),
          root.path,
        )
        expect(settled.status).toBe("completed")
        expect(settled.metadata).toEqual({
          files: [expect.objectContaining({ file: "../shared.txt", status: "modified", additions: 1, deletions: 1 })],
        })
      }),
    ),
  )
})
