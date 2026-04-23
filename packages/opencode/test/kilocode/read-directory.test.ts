import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { symlink } from "fs/promises"
import path from "path"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { LSP } from "../../src/lsp"
import { Instruction } from "../../src/session/instruction"
import { Truncate } from "../../src/tool"
import { MessageID, SessionID } from "../../src/session/schema"
import { ReadTool } from "../../src/tool/read"
import { Tool } from "../../src/tool"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const baseCtx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: () => Effect.void,
}

const expandCtx = { ...baseCtx, extra: { includeDirectoryFiles: true } }

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Instruction.defaultLayer,
    LSP.defaultLayer,
    Truncate.defaultLayer,
  ),
)

const init = Effect.fn("ReadDirectoryTest.init")(function* () {
  const info = yield* ReadTool
  return yield* Tool.init(info)
})

const run = Effect.fn("ReadDirectoryTest.run")(function* (
  args: Tool.InferParameters<typeof ReadTool>,
  ctx = expandCtx,
) {
  const tool = yield* init()
  return yield* tool.execute(args, ctx as any)
})

const exec = Effect.fn("ReadDirectoryTest.exec")(function* (
  dir: string,
  args: Tool.InferParameters<typeof ReadTool>,
  ctx = expandCtx,
) {
  return yield* provideInstance(dir)(run(args, ctx))
})

const put = Effect.fn("ReadDirectoryTest.put")(function* (p: string, content: string | Uint8Array) {
  const fs = yield* AppFileSystem.Service
  yield* fs.writeWithDirs(p, content)
})

describe("kilocode directory reads", () => {
  it.live("includes top-level file contents for directory reads", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "folder", "a.txt"), "alpha")
      yield* put(path.join(dir, "folder", "nested", "b.txt"), "beta")
      yield* put(path.join(dir, "folder", "binary.bin"), new Uint8Array([0, 1, 2]))

      const result = yield* exec(dir, { filePath: path.join(dir, "folder") })

      expect(result.output).toContain("a.txt")
      expect(result.output).toContain('<file_content path="folder/a.txt">\nalpha\n</file_content>')
      expect(result.output).not.toContain('<file_content path="folder/nested/b.txt">')
      expect(result.output).not.toContain('<file_content path="folder/binary.bin">')
      expect(result.metadata.loaded).toContain(path.join(dir, "folder", "a.txt"))
    }),
  )

  it.live("skips content inlining without the kilo flag", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "folder", "a.txt"), "alpha")

      const result = yield* exec(dir, { filePath: path.join(dir, "folder") }, baseCtx)

      expect(result.output).toContain("a.txt")
      expect(result.output).not.toContain('<file_content path="folder/a.txt">')
      expect(result.metadata.loaded).toEqual([])
    }),
  )

  if (process.platform !== "win32") {
    it.live("skips symlinked top-level files", () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const outer = yield* tmpdirScoped()
        yield* put(path.join(dir, "folder", "a.txt"), "alpha")
        yield* put(path.join(outer, "secret.txt"), "secret")
        yield* Effect.promise(() => symlink(path.join(outer, "secret.txt"), path.join(dir, "folder", "secret.txt")))

        const result = yield* exec(dir, { filePath: path.join(dir, "folder") })

        expect(result.output).toContain("secret.txt")
        expect(result.output).not.toContain('<file_content path="folder/secret.txt">')
        expect(result.output).not.toContain("secret\n</file_content>")
        expect(result.metadata.loaded).not.toContain(path.join(dir, "folder", "secret.txt"))
      }),
    )
  }
})
