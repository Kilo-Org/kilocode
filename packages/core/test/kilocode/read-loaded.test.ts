import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Config } from "@opencode/core/config"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Image } from "@opencode/core/image"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { SessionInstructions } from "@opencode/core/session/instructions"
import { AbsolutePath } from "@opencode/core/schema"
import { Tool } from "@opencode/core/tool"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { ReadToolFileSystem } from "@opencode/core/tool/read-filesystem"
import { FileAccess } from "@opencode/core/file-access"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { permissionLayer } from "../lib/permission"
import { toolIdentity, executeTool, registerToolPlugin } from "../lib/tool"

const readToolNode = makeLocationNode({
  name: "test/kilocode/read-loaded",
  layer: Layer.effectDiscard(registerToolPlugin(ReadTool.Plugin)),
  deps: [
    Tool.node,
    ReadToolFileSystem.node,
    FileAccess.node,
    Image.node,
    Permission.node,
    SessionInstructions.node,
    FSUtil.node,
    Location.node,
  ],
})

const sessionID = Session.ID.make("ses_read_loaded_test")

const reader = Layer.succeed(
  ReadToolFileSystem.Service,
  ReadToolFileSystem.Service.of({
    list: () => Effect.succeed([]),
    read: () =>
      Effect.succeed({
        type: "file",
        uri: "file:///pkg/file.txt",
        name: "file.txt",
        content: "hello\n",
        encoding: "utf8",
        mime: "text/plain",
      }),
  }),
)

const permission = permissionLayer({ assert: () => Effect.void })

const readLayer = (directory: string, loaded: string[][]) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  const instructions = Layer.mock(SessionInstructions.Service, {
    load: (input) =>
      Effect.sync(() => {
        loaded.push([...input.paths])
      }),
  })
  const imageLayer = AppNodeBuilder.build(Image.node)
  const config = Config.testLayer()
  return Layer.mergeAll(
    AppNodeBuilder.build(LayerNode.group([Tool.node, readToolNode]), [
      ReadToolFileSystem.node.replace(reader),
      Permission.node.replace(permission),
      Config.node.replace(config),
      Image.node.replace(imageLayer),
      Location.node.replace(activeLocation),
      SessionInstructions.node.replace(instructions),
      Global.node.replace(Global.layerWith({ data: Global.Path.data })),
    ]),
    config,
    imageLayer,
  )
}

describe("read tool loaded instructions", () => {
  testEffect(Layer.empty).live("reports the discovered instruction files in metadata", () => {
    const loaded: string[][] = []
    return Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const repo = path.join(tmp.path, "repo")
          const pkg = path.join(repo, "pkg")
          yield* Effect.promise(() => fs.mkdir(pkg, { recursive: true }))
          const agents = path.join(pkg, "AGENTS.md")
          yield* Effect.promise(() => fs.writeFile(agents, "Follow the package rules.\n"))

          const registry = yield* Tool.Service
          const execution = yield* executeTool(registry, {
            sessionID,
            ...toolIdentity,
            call: { type: "tool-call", id: "call-read-loaded", name: "read", input: { path: "pkg/file.txt" } },
          })

          expect(execution.status).toBe("completed")
          if (execution.status !== "completed") return
          expect(execution.metadata).toEqual({ truncated: false, loaded: [agents] })
          expect(loaded).toEqual([[agents]])
        }).pipe(Effect.provide(readLayer(path.join(tmp.path, "repo"), loaded))),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
  })
})
