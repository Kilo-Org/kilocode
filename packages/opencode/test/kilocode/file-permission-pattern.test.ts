import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { LSP } from "@/lsp/lsp"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Truncate } from "@/tool/truncate"
import { Tool } from "@/tool/tool"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Format } from "../../src/format"
import { Agent } from "../../src/agent/agent"
import { Instruction } from "../../src/session/instruction"
import { SessionID, MessageID } from "../../src/session/schema"
import { WriteTool } from "../../src/tool/write"
import { EditTool } from "../../src/tool/edit"
import { ReadTool } from "../../src/tool/read"
import { ApplyPatchTool } from "../../src/tool/apply_patch"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      LSP.node,
      FSUtil.node,
      EventV2Bridge.node,
      Format.node,
      CrossSpawnSpawner.node,
      Truncate.node,
      Agent.node,
      Instruction.node,
    ]),
  ),
)

const asking = () => {
  const asked: { permission: string; patterns: readonly string[] }[] = []
  const ctx: Tool.Context = {
    sessionID: SessionID.make("ses_test-file-permission"),
    messageID: MessageID.make("msg_test"),
    callID: "",
    agent: "code",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (req) => Effect.sync(() => void asked.push({ permission: req.permission, patterns: req.patterns })),
  }
  return { asked, ctx }
}

const execute = Effect.fn("FilePermissionPatternTest.execute")(function* (
  tool: Tool.Info,
  args: any,
  ctx: Tool.Context,
) {
  const ready = yield* Tool.init(tool)
  return yield* ready.execute(args, ctx)
})

// A project outside git has worktree "/". Rules such as ".local/*.md" are
// written from the project directory, so the patterns they meet must be too.
describe.each([
  ["outside git", false],
  ["in a git repository", true],
])("file permission patterns %s", (_label, git) => {
  it.instance(
    "are relative to the project directory",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const target = path.join(directory, ".local", "test", "note.md")
        const { asked, ctx } = asking()

        yield* execute(yield* WriteTool, { filePath: target, content: "zero\n" }, ctx)
        yield* execute(yield* EditTool, { filePath: target, oldString: "zero", newString: "one" }, ctx)
        yield* execute(
          yield* ApplyPatchTool,
          {
            patchText: ["*** Begin Patch", `*** Update File: ${target}`, "@@", "-one", "+two", "*** End Patch"].join(
              "\n",
            ),
          },
          ctx,
        )
        yield* execute(yield* ReadTool, { filePath: target }, ctx)
        yield* Effect.promise(() => fs.rm(target))

        expect(asked.filter((a) => a.permission === "edit" || a.permission === "read")).toEqual([
          { permission: "edit", patterns: [".local/test/note.md"] },
          { permission: "edit", patterns: [".local/test/note.md"] },
          { permission: "edit", patterns: [".local/test/note.md"] },
          { permission: "read", patterns: [".local/test/note.md"] },
        ])
      }),
    { git },
  )
})
