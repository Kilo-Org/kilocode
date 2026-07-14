import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LSP } from "../../src/lsp/lsp"
import { Instruction } from "../../src/session/instruction"
import { MessageID, SessionID } from "../../src/session/schema"
import { ReadTool } from "../../src/tool/read"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx = {
  sessionID: SessionID.make("ses_instruction_attachment"),
  messageID: MessageID.make("msg_instruction_attachment"),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    FSUtil.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Instruction.defaultLayer,
    LSP.defaultLayer,
    Truncate.defaultLayer,
    testInstanceStoreLayer,
  ),
)

const put = Effect.fn("InstructionAttachmentTest.put")(function* (file: string, bytes: Uint8Array | string) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(file, bytes)
})

describe("read attachment instructions", () => {
  it.live("includes loaded instructions when reading an image", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
        "base64",
      )
      const file = path.join(dir, "subdir", "image.png")
      yield* put(path.join(dir, "subdir", "AGENTS.md"), "# Image Instructions")
      yield* put(file, png)

      const info = yield* ReadTool
      const tool = yield* Tool.init(info)
      const result = yield* provideInstance(dir)(tool.execute({ filePath: file }, ctx))

      expect(result.output).toContain("Image read successfully")
      expect(result.output).toContain("<system-reminder>")
      expect(result.output).toContain("# Image Instructions")
      expect(result.metadata.loaded).toContain(path.join(dir, "subdir", "AGENTS.md"))
    }),
  )
})
