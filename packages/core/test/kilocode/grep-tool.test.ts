import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Reference } from "@opencode-ai/core/reference"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { GrepTool } from "@opencode-ai/core/tool/grep"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
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

describe("GrepTool managed output", () => {
  test("searches an absolute retained output file", async () => {
    await using tmp = await tmpdir()
    const worktree = path.join(tmp.path, "worktree")
    const data = path.join(tmp.path, "data")
    const output = path.join(data, ToolOutputStore.MANAGED_DIRECTORY, "tool_123")
    await fs.mkdir(worktree)
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.writeFile(output, "first\nneedle\nlast")

    const layers = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GrepTool.node]), [
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      [Global.node, Global.layerWith({ data })],
      [
        Location.node,
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(worktree) }))),
      ],
      [PermissionV2.node, permission()],
      [Reference.node, references()],
    ])
    const result = await Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      return yield* executeTool(registry, {
        sessionID: SessionV2.ID.make("ses_grep_managed_test"),
        ...toolIdentity,
        call: { type: "tool-call", id: "call-grep-managed", name: "grep", input: { pattern: "needle", path: output } },
      })
    }).pipe(Effect.provide(layers), Effect.scoped, Effect.runPromise)

    expect(result.type).toBe("text")
    if (result.type !== "text") return
    expect(result.value).toContain("needle")
    expect(result.value).toContain(output)
  })

  test("searches an in-workspace tool-prefixed file before managed output exists", async () => {
    await using tmp = await tmpdir()
    const worktree = path.join(tmp.path, "worktree")
    const data = path.join(tmp.path, "data")
    const output = path.join(worktree, "tool_notes.ts")
    await fs.mkdir(worktree)
    await fs.mkdir(data)
    await fs.writeFile(output, "first\nneedle\nlast")

    const layers = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GrepTool.node]), [
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      [Global.node, Global.layerWith({ data })],
      [
        Location.node,
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(worktree) }))),
      ],
      [PermissionV2.node, permission()],
      [Reference.node, references()],
    ])
    const result = await Effect.gen(function* () {
      const tools = yield* ToolRegistry.Service
      return yield* executeTool(tools, {
        sessionID: SessionV2.ID.make("ses_grep_workspace_test"),
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-grep-workspace",
          name: "grep",
          input: { pattern: "needle", path: output },
        },
      })
    }).pipe(Effect.provide(layers), Effect.scoped, Effect.runPromise)

    expect(result.type).toBe("text")
    if (result.type !== "text") return
    expect(result.value).toContain("needle")
    expect(result.value).toContain(output)
  })

  test("confines named references and records permission metadata", async () => {
    await using tmp = await tmpdir()
    const worktree = path.join(tmp.path, "worktree")
    const data = path.join(tmp.path, "data")
    const docs = path.join(tmp.path, "docs")
    const output = path.join(data, ToolOutputStore.MANAGED_DIRECTORY, "tool_reference")
    await fs.mkdir(worktree)
    await fs.mkdir(docs)
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.writeFile(path.join(docs, "guide.md"), "reference needle")
    await fs.writeFile(output, "retained needle")
    const requests: PermissionV2.AssertInput[] = []
    const source = Reference.LocalSource.make({ type: "local", path: AbsolutePath.make(docs) })
    const layers = AppNodeBuilder.build(
      LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GrepTool.node]),
      [
        [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
        [Global.node, Global.layerWith({ data })],
        [
          Location.node,
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(worktree) }))),
        ],
        [PermissionV2.node, permission(requests)],
        [Reference.node, references([new Reference.Info({ name: "docs", path: source.path, source })])],
      ],
    )
    const run = (id: string, input: Record<string, unknown>) =>
      Effect.gen(function* () {
        const tools = yield* ToolRegistry.Service
        return yield* executeTool(tools, {
          sessionID: SessionV2.ID.make("ses_grep_reference_test"),
          ...toolIdentity,
          call: { type: "tool-call", id, name: "grep", input },
        })
      }).pipe(Effect.provide(layers), Effect.scoped, Effect.runPromise)

    const result = await run("call-grep-reference", { pattern: "needle", reference: "docs" })
    expect(result.type).toBe("text")
    if (result.type === "text") {
      expect(result.value).toContain("reference needle")
      expect(result.value).toContain(path.join(docs, "guide.md"))
    }
    expect(requests[0]?.metadata).toMatchObject({ reference: "docs" })

    const missing = await run("call-grep-reference-missing", { pattern: "needle", reference: "missing" })
    expect(missing.type).toBe("error")

    const escaped = await run("call-grep-reference-escape", {
      pattern: "needle",
      path: output,
      reference: "docs",
    })
    expect(escaped.type).toBe("error")
  })
})
