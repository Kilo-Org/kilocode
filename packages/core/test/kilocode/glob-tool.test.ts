import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Reference } from "@opencode-ai/core/reference"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { GlobTool } from "@opencode-ai/core/tool/glob"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { executeTool, toolIdentity } from "../lib/tool"

const permission = (requests: PermissionV2.AssertInput[] = []) =>
  Layer.succeed(
    PermissionV2.Service,
    PermissionV2.Service.of({
      assert: (input) => Effect.sync(() => requests.push(input)).pipe(Effect.asVoid),
      ask: () => Effect.die("unused"),
      reply: () => Effect.die("unused"),
      get: () => Effect.die("unused"),
      forSession: () => Effect.die("unused"),
      list: () => Effect.die("unused"),
    }),
  )

const references = (items: Reference.Info[] = []) =>
  Layer.succeed(
    Reference.Service,
    Reference.Service.of({
      transform: () => Effect.die("unused"),
      reload: () => Effect.die("unused"),
      replace: () => Effect.die("unused"),
      list: () => Effect.succeed(items),
    }),
  )

describe("GlobTool search targets", () => {
  test("records the resolved root for a relative path", async () => {
    await using tmp = await tmpdir()
    const worktree = path.join(tmp.path, "worktree")
    const data = path.join(tmp.path, "data")
    const nested = path.join(worktree, "src")
    await fs.mkdir(nested, { recursive: true })
    await fs.mkdir(data)
    await fs.writeFile(path.join(nested, "main.ts"), "export const main = 1")
    const requests: PermissionV2.AssertInput[] = []

    const layers = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GlobTool.node]), [
      [Global.node, Global.layerWith({ data })],
      [
        Location.node,
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(worktree) }))),
      ],
      [PermissionV2.node, permission(requests)],
      [Reference.node, references()],
    ])
    const run = (id: string, input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const tools = yield* ToolRegistry.Service
        return yield* executeTool(tools, {
          sessionID: SessionV2.ID.make("ses_glob_relative_test"),
          ...toolIdentity,
          call: { type: "tool-call", id, name: "glob", input },
        })
      }).pipe(Effect.provide(layers), Effect.scoped, Effect.runPromise)

    const relative = await run("call-glob-relative", { pattern: "*.ts", path: "src" })
    expect(relative.type).toBe("text")
    if (relative.type === "text") expect(relative.value).toContain(path.join(nested, "main.ts"))
    expect(requests).toHaveLength(1)
    expect(requests[0]?.metadata?.root).toBe(await fs.realpath(nested))
    expect(requests[0]?.metadata?.path).toBe("src")

    const escaped = await run("call-glob-escape", { pattern: "*.ts", path: "../outside" })
    expect(escaped.type).toBe("error")
    expect(requests).toHaveLength(1)
  })

  test("records the reference directory as the search root", async () => {
    await using tmp = await tmpdir()
    const worktree = path.join(tmp.path, "worktree")
    const data = path.join(tmp.path, "data")
    const docs = path.join(tmp.path, "docs")
    await fs.mkdir(worktree)
    await fs.mkdir(data)
    await fs.mkdir(docs)
    await fs.writeFile(path.join(docs, "guide.md"), "reference guide")
    const requests: PermissionV2.AssertInput[] = []
    const source = Reference.LocalSource.make({ type: "local", path: AbsolutePath.make(docs) })
    const layers = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GlobTool.node]), [
      [Global.node, Global.layerWith({ data })],
      [
        Location.node,
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(worktree) }))),
      ],
      [PermissionV2.node, permission(requests)],
      [Reference.node, references([new Reference.Info({ name: "docs", path: source.path, source })])],
    ])
    const result = await Effect.gen(function* () {
      const tools = yield* ToolRegistry.Service
      return yield* executeTool(tools, {
        sessionID: SessionV2.ID.make("ses_glob_reference_test"),
        ...toolIdentity,
        call: { type: "tool-call", id: "call-glob-reference", name: "glob", input: { pattern: "*.md", reference: "docs" } },
      })
    }).pipe(Effect.provide(layers), Effect.scoped, Effect.runPromise)

    expect(result.type).toBe("text")
    if (result.type === "text") expect(result.value).toContain(path.join(docs, "guide.md"))
    expect(requests).toHaveLength(1)
    expect(requests[0]?.metadata).toMatchObject({ reference: "docs" })
    expect(requests[0]?.metadata?.root).toBe(await fs.realpath(docs))
    expect(requests[0]?.metadata?.root).not.toBe(await fs.realpath(worktree))
  })
})
