import { expect } from "bun:test"
import path from "node:path"
import { Effect, Layer, PlatformError } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Project } from "@/project/project"
import { exists } from "@/kilocode/project/sandbox"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const denied = PlatformError.systemError({
  _tag: "PermissionDenied",
  module: "FileSystem",
  method: "access",
})
const layer = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return {
      ...fs,
      exists: (dir: string) => (path.basename(dir) === "denied" ? Effect.fail(denied) : fs.exists(dir)),
    }
  }),
).pipe(Layer.provide(AppNodeBuilder.build(FSUtil.node)))
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Project.node, FSUtil.node, CrossSpawnSpawner.node]), [[FSUtil.node, layer]]),
)

it.live("opens a project while retaining denied historical sandboxes and pruning missing ones", () =>
  Effect.gen(function* () {
    const project = yield* Project.Service
    const dir = yield* tmpdirScoped({ git: true })
    const sibling = yield* tmpdirScoped()
    const saved = yield* project.fromDirectory(dir)
    const historical = path.join(dir, "denied")
    yield* project.addSandbox(saved.project.id, historical)
    yield* project.addSandbox(saved.project.id, path.join(dir, "missing"))
    yield* project.addSandbox(saved.project.id, sibling)

    const result = yield* project.fromDirectory(dir)

    expect(result.sandbox).toBe(dir)
    expect(result.project.worktree).toBe(dir)
    expect(result.project.sandboxes).toEqual([historical, sibling])
    expect((yield* project.get(saved.project.id))?.sandboxes).toEqual([historical, sibling])
  }),
)

it.live("does not hide permission errors for the current checkout", () =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const result = yield* exists(fs, "/denied", "/denied").pipe(Effect.flip)
    expect(result).toBe(denied)
  }),
)

it.live("does not hide other historical filesystem errors", () =>
  Effect.gen(function* () {
    const error = PlatformError.systemError({ _tag: "Unknown", module: "FileSystem", method: "access" })
    const result = yield* exists({ exists: () => Effect.fail(error) }, "/old", "/current").pipe(Effect.flip)
    expect(result).toBe(error)
  }),
)
