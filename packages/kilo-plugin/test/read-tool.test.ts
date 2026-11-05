import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionInstructions } from "@opencode/core/session/instructions"
import { Tool } from "@opencode/core/tool"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { ReadToolFileSystem } from "@opencode/core/tool/read-filesystem"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { hostEnvironmentLayer } from "../../core/test/fixture/environment"
import { location } from "../../core/test/fixture/location"
import { withTempDir } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { permissionLayer } from "../../core/test/lib/permission"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "../../core/test/lib/tool"
import { KiloRead } from "../src/read"

const sessionID = Session.ID.make("ses_kilo_read_test")

const node = makeLocationNode({
  name: "test/kilo-read-tool",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      yield* registerToolPlugin(ReadTool.Plugin)
      yield* registerToolPlugin(KiloRead.KiloReadPlugin)
    }),
  ),
  deps: [Tool.node, ReadToolFileSystem.node, FileAccess.node, SessionInstructions.node, FSUtil.node, Location.node],
})

const withTool = <A, E, R>(directory: string, body: (registry: Tool.Interface) => Effect.Effect<A, E, R>) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of({
      ...location({ directory: AbsolutePath.make(directory) }),
      project: {
        id: Project.ID.global,
        directory: AbsolutePath.make(directory),
        canonical: AbsolutePath.make(directory),
      },
    }),
  )
  return Effect.gen(function* () {
    const registry = yield* Tool.Service
    return yield* body(registry)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Tool.node, node]), [
        ReadToolFileSystem.node.replace(KiloRead.node),
        Environment.node.replace(hostEnvironmentLayer),
        Location.node.replace(activeLocation),
        Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
      ]),
    ),
  )
}

const read = (input: { path: string; offset?: number; limit?: number }) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: "call-read", name: "read", input },
})

const notebook = JSON.stringify({
  cells: [
    { cell_type: "markdown", source: ["# Analysis\n", "Useful introduction"] },
    { cell_type: "code", source: ["value = 42"] },
  ],
})

const it = testEffect(Layer.empty)

describe("kilo read tool", () => {
  it.live("keeps the native description and appends the extracted formats sentence", () =>
    withTempDir((tmp) =>
      withTool(tmp.path, (registry) =>
        Effect.gen(function* () {
          const definitions = yield* toolDefinitions(registry)
          const definition = definitions.find((tool) => tool.name === "read")

          expect(definition?.description).toContain("Supports text files, images, and PDFs.")
          expect(definition?.description).toEndWith(KiloRead.DESCRIPTION_SUFFIX)
          expect(definitions.map((tool) => tool.name)).toContain("read")
        }),
      ),
    ),
  )

  it.live("reads a notebook through the native read tool", () =>
    withTempDir((tmp) => {
      return Effect.promise(() => Bun.write(path.join(tmp.path, "analysis.ipynb"), notebook)).pipe(
        Effect.andThen(
          withTool(tmp.path, (registry) => executeTool(registry, read({ path: "analysis.ipynb" }))),
        ),
        Effect.tap((execution) =>
          Effect.sync(() => {
            expect(execution.status).toBe("completed")
            expect(execution.metadata?.truncated).toBe(false)
            expect(execution.content).toEqual([
              {
                type: "text",
                text: [
                  "Read file analysis.ipynb, lines 1-8",
                  "1: <markdown_cell>",
                  "2: # Analysis",
                  "3: Useful introduction",
                  "4: </markdown_cell>",
                  "5: ",
                  "6: <code_cell>",
                  "7: value = 42",
                  "8: </code_cell>",
                ].join("\n"),
              },
            ])
          }),
        ),
      )
    }),
  )

  it.live("pages a notebook with the native offset and limit", () =>
    withTempDir((tmp) => {
      return Effect.promise(() => Bun.write(path.join(tmp.path, "paged.ipynb"), notebook)).pipe(
        Effect.andThen(
          withTool(tmp.path, (registry) =>
            executeTool(registry, read({ path: "paged.ipynb", offset: 2, limit: 2 })),
          ),
        ),
        Effect.tap((execution) =>
          Effect.sync(() => {
            expect(execution.status).toBe("completed")
            expect(execution.metadata?.truncated).toBe(true)
            expect(execution.content).toEqual([
              {
                type: "text",
                text: [
                  "Read file paged.ipynb, lines 2-3",
                  "2: # Analysis",
                  "3: Useful introduction",
                  "[Output truncated. Continue reading with offset: 4]",
                ].join("\n"),
              },
            ])
          }),
        ),
      )
    }),
  )

  it.live("keeps ordinary text reads unchanged", () =>
    withTempDir((tmp) => {
      return Effect.promise(() => Bun.write(path.join(tmp.path, "notes.txt"), "plain text")).pipe(
        Effect.andThen(withTool(tmp.path, (registry) => executeTool(registry, read({ path: "notes.txt" })))),
        Effect.tap((execution) =>
          Effect.sync(() => {
            expect(execution.status).toBe("completed")
            expect(execution.content).toEqual([
              { type: "text", text: "Read file notes.txt, lines 1-1\n1: plain text" },
            ])
          }),
        ),
      )
    }),
  )
})
