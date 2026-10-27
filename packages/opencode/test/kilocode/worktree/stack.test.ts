import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { Git } from "../../../src/git"
import { WorktreeStack } from "../../../src/kilocode/worktree/stack"
import { tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"
import { httpApiLayer, requestInDirectory } from "../../server/httpapi-layer"
import spec from "../../../../sdk/openapi.json"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(Git.node), AppNodeBuilder.build(CrossSpawnSpawner.node)))
const api = testEffect(
  Layer.mergeAll(httpApiLayer, AppNodeBuilder.build(Git.node), AppNodeBuilder.build(CrossSpawnSpawner.node)),
)
const run = Effect.fnUntraced(function* (cwd: string, args: string[]) {
  const result = yield* (yield* Git.Service).run(args, { cwd })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return result.text().trim()
})
const fixture = Effect.fnUntraced(function* () {
  const root = yield* tmpdirScoped({ git: true })
  yield* run(root, ["branch", "-M", "main"])
  const a = path.join(root, ".kilo", "worktrees", "a")
  const b = path.join(root, ".kilo", "worktrees", "b")
  yield* run(root, ["worktree", "add", "-b", "feat/a", a])
  yield* run(root, ["worktree", "add", "-b", "feat/b", b])
  return { root, a, b }
})

describe("worktree stack", () => {
  test("preserves root and unknown-count nullability in the generated public contract", () => {
    const node =
      spec.paths["/kilocode/worktree/stack"].get.responses["200"].content["application/json"].schema.properties.nodes
        .items
    expect(node.properties.parentBranch.anyOf).toContainEqual({ type: "null" })
    expect(node.properties.parentWorktreeID.anyOf).toContainEqual({ type: "null" })
    expect(node.properties.git.properties.ahead.anyOf).toContainEqual({ type: "null" })
  })
  it.live("handles unusual paths and excludes unused pool slots and unmanaged checkouts", () =>
    Effect.gen(function* () {
      const { root, a } = yield* fixture()
      const admin = yield* run(a, [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "kilo-agent-manager-metadata.json",
      ])
      yield* Effect.promise(() => Bun.write(admin, JSON.stringify({ pooled: true })))
      const dir = path.join(root, ".kilo", "worktrees", process.platform === "win32" ? "with spaces" : "with spaces\n")
      yield* run(root, ["worktree", "add", "-b", "odd", dir])
      yield* run(root, ["worktree", "add", "-b", "unmanaged", path.join(root, "unmanaged")])
      const forest = yield* WorktreeStack.read(root)
      expect(forest.nodes.some((node) => node.path === a)).toBe(false)
      expect(forest.nodes.some((node) => node.branch === "unmanaged")).toBe(false)
      expect(forest.nodes.some((node) => node.path === dir)).toBe(true)
    }),
  )
  it.live("reads a three-node stack depth-first without changing refs, config, or index", () =>
    Effect.gen(function* () {
      const { root, a, b } = yield* fixture()
      yield* run(root, ["config", "branch.feat/a.kilo-stack-parent", "main"])
      yield* run(root, ["config", "branch.feat/b.kilo-stack-parent", "feat/a"])
      const refs = yield* run(root, ["show-ref"])
      const config = yield* run(root, ["config", "--local", "--list"])
      const index = yield* run(root, ["ls-files", "--stage"])
      const forest = yield* WorktreeStack.read(b)
      expect(forest.roots).toEqual([root])
      expect(forest.nodes.map((node) => [node.path, node.state, node.parentWorktreeID])).toEqual([
        [root, "root", null],
        [a, "attached", root],
        [b, "attached", a],
      ])
      expect(forest.diagnostics).toEqual([])
      expect(yield* Schema.decodeUnknownEffect(WorktreeStack.Forest)(forest)).toEqual(forest)
      expect(yield* run(root, ["show-ref"])).toBe(refs)
      expect(yield* run(root, ["config", "--local", "--list"])).toBe(config)
      expect(yield* run(root, ["ls-files", "--stage"])).toBe(index)
    }),
  )

  it.live("uses git-admin and legacy metadata, preserves missing parents, and rechecks config", () =>
    Effect.gen(function* () {
      const { root, a, b } = yield* fixture()
      const admin = yield* run(a, [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "kilo-agent-manager-metadata.json",
      ])
      yield* Effect.promise(() => Bun.write(admin, JSON.stringify({ parentBranch: "main" })))
      yield* Effect.promise(() =>
        Bun.write(path.join(b, ".kilocode", "metadata.json"), JSON.stringify({ parentBranch: "feat/a" })),
      )
      expect((yield* WorktreeStack.read(root)).nodes.find((node) => node.path === b)?.parentWorktreeID).toBe(a)
      yield* run(root, ["config", "branch.feat/b.kilo-stack-parent", "missing"])
      const node = (yield* WorktreeStack.read(root)).nodes.find((node) => node.path === b)
      expect(node?.state).toBe("detached")
      expect(node?.parentBranch).toBe("missing")
      expect(node?.parentWorktreeID).toBeNull()
    }),
  )

  it.live("detaches only cycle edges and preserves valid children and unrelated nodes", () =>
    Effect.gen(function* () {
      const { root, a, b } = yield* fixture()
      yield* run(root, ["config", "branch.feat/a.kilo-stack-parent", "feat/b"])
      yield* run(root, ["config", "branch.feat/b.kilo-stack-parent", "feat/a"])
      yield* run(root, ["config", "branch.main.kilo-stack-parent", "main"])
      const child = path.join(root, ".kilo", "worktrees", "child")
      yield* run(root, ["worktree", "add", "-b", "child", child])
      yield* run(root, ["config", "branch.child.kilo-stack-parent", "feat/a"])
      const forest = yield* WorktreeStack.read(root)
      expect(forest.diagnostics).toEqual([
        { code: "self-edge", worktreeIDs: [root] },
        { code: "cycle", worktreeIDs: [a, b] },
      ])
      expect(forest.nodes.find((node) => node.path === child)?.state).toBe("attached")
      expect(forest.nodes.filter((node) => node.state === "detached").map((node) => node.path)).toEqual([root, a, b])
    }),
  )

  it.live("returns independent roots with no edges and reads agent-manager fallback", () =>
    Effect.gen(function* () {
      const { root, a, b } = yield* fixture()
      expect((yield* WorktreeStack.read(root)).roots).toEqual([root, a, b])
      yield* Effect.promise(() =>
        Bun.write(
          path.join(root, ".kilo", "agent-manager.json"),
          JSON.stringify({ worktrees: { b: { path: b, parentBranch: "feat/a" } } }),
        ),
      )
      expect((yield* WorktreeStack.read(root)).nodes.find((node) => node.path === b)?.parentWorktreeID).toBe(a)
    }),
  )

  it.live("computes child ahead, parent behind, and actual merge conflicts", () =>
    Effect.gen(function* () {
      const { root, a, b } = yield* fixture()
      yield* run(root, ["config", "branch.feat/b.kilo-stack-parent", "feat/a"])
      for (const dir of [a, b]) {
        yield* Effect.promise(() => Bun.write(path.join(dir, "conflict.txt"), dir))
        yield* run(dir, ["add", "conflict.txt"])
        yield* run(dir, [
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-m",
          "change",
        ])
      }
      expect((yield* WorktreeStack.read(root)).nodes.find((node) => node.path === b)?.git).toEqual({
        ahead: 1,
        behind: 1,
        conflicts: true,
      })
    }),
  )

  it.live("rejects unknown directories and non-repositories with actionable errors", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const result = yield* WorktreeStack.read(dir).pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      const missing = yield* WorktreeStack.read(path.join(dir, "missing")).pipe(Effect.result)
      expect(missing._tag).toBe("Failure")
    }),
  )

  api.live("serves typed cycle diagnostics with HTTP 200 through the directory-scoped route", () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped({ git: true })
      yield* run(root, ["branch", "-M", "main"])
      yield* run(root, ["config", "branch.main.kilo-stack-parent", "main"])
      const response = yield* requestInDirectory("/kilocode/worktree/stack", root)
      expect(response.status).toBe(200)
      const forest = yield* Schema.decodeUnknownEffect(WorktreeStack.Forest)(yield* response.json)
      expect(forest.diagnostics).toEqual([{ code: "self-edge", worktreeIDs: [root] }])
      expect(forest.nodes.at(0)?.state).toBe("detached")
    }),
  )
})
