import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { LSP } from "../../src/lsp"
import type { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { Tool, Truncate } from "../../src/tool"
import { WriteTool } from "../../src/tool/write"
import { Filesystem } from "../../src/util"
import { Bus } from "../../src/bus"
import { Format } from "../../src/format"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { provideInstance, tmpdir, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx = {
  sessionID: SessionID.make("ses_test-boundary-session"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(
    LSP.defaultLayer,
    AppFileSystem.defaultLayer,
    Bus.layer,
    Format.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const init = Effect.fn("BoundaryTest.init")(function* () {
  const info = yield* WriteTool
  return yield* info.init()
})

const write = Effect.fn("BoundaryTest.write")(function* (
  args: Tool.InferParameters<typeof WriteTool>,
  next: Tool.Context = ctx,
) {
  const tool = yield* init()
  return yield* tool.execute(args, next)
})

const glob = (p: string) =>
  process.platform === "win32" ? AppFileSystem.normalizePathPattern(p) : p.replaceAll("\\", "/")

const asks = () => {
  const items: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  return {
    items,
    next: {
      ...ctx,
      ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
        Effect.sync(() => {
          items.push(req)
        }),
    },
  }
}

describe("kilocode external directory boundaries", () => {
  it.live("asks before writing outside a repo-root session", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const outer = yield* tmpdirScoped()
      const file = path.join(outer, "outside.txt")
      const { items, next } = asks()

      yield* provideInstance(dir)(write({ filePath: file, content: "outside" }, next))

      const ext = items.find((item) => item.permission === "external_directory")
      expect(ext).toBeDefined()
      expect(ext!.patterns).toEqual([glob(path.join(outer, "*"))])
      expect(ext!.always).toEqual([glob(path.join(outer, "*"))])
      expect(ext!.metadata).toMatchObject({ filepath: file, parentDir: outer })

      const first = items.findIndex((item) => item.permission === "external_directory")
      const second = items.findIndex((item) => item.permission === "edit")
      expect(first).toBeGreaterThanOrEqual(0)
      expect(second).toBeGreaterThan(first)
    }),
  )

  it.live("asks when the instance directory is a filesystem root", () =>
    Effect.gen(function* () {
      const outer = yield* tmpdirScoped()
      const root = path.parse(outer).root
      const file = path.join(outer, "outside-root.txt")
      const { items, next } = asks()

      yield* provideInstance(root)(write({ filePath: file, content: "outside root" }, next))

      const ext = items.find((item) => item.permission === "external_directory")
      expect(ext).toBeDefined()
      expect(ext!.patterns).toEqual([glob(path.join(outer, "*"))])
      expect(ext!.metadata).toMatchObject({ filepath: file, parentDir: outer })
    }),
  )

  test("Instance.containsPath rejects filesystem root boundaries", async () => {
    await using tmp = await tmpdir()
    const root = path.parse(tmp.path).root

    await Instance.provide({
      directory: root,
      fn: () => {
        expect(Instance.containsPath(path.join(tmp.path, "file.txt"))).toBe(false)
      },
    })
  })

  test("contains helpers keep dot-prefixed child names internal", () => {
    expect(Filesystem.contains("/project", "/project/..cache/file")).toBe(true)
    expect(AppFileSystem.contains("/a/b", "/a/b/..cache/file")).toBe(true)
  })

  test("AppFileSystem.contains rejects cross-drive paths on Windows", () => {
    if (process.platform !== "win32") return
    expect(AppFileSystem.contains("C:\\repo", "D:\\outside\\file.txt")).toBe(false)
  })
})
