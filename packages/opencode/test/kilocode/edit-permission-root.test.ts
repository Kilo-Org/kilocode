import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import path from "path"
import { WriteTool } from "../../src/tool/write"
import { EditTool } from "../../src/tool/edit"
import { ApplyPatchTool } from "../../src/tool/apply_patch"
import { LSP } from "@/lsp/lsp"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Format } from "../../src/format"
import { Truncate } from "@/tool/truncate"
import { Tool } from "@/tool/tool"
import { Agent } from "../../src/agent/agent"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

type Asked = { permission: string; patterns: string[] }

function context(asked: Asked[]): Tool.Context {
  return {
    sessionID: SessionID.make("ses_test-edit-permission-root"),
    messageID: MessageID.make("msg_test"),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (input) =>
      Effect.sync(() => {
        asked.push({ permission: input.permission, patterns: [...input.patterns] })
      }),
  }
}

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
    ]),
  ),
)

const target = path.join(".local", "test", "test.md")

function editPatterns(asked: Asked[]) {
  return asked
    .filter((item) => item.permission === "edit")
    .flatMap((item) => item.patterns.map((p) => p.replaceAll("\\", "/")))
}

describe("edit permission patterns", () => {
  for (const git of [false, true]) {
    const label = git ? "in a git repository" : "in a folder without git"

    it.instance(
      `write asks with a path relative to the workspace ${label}`,
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const asked: Asked[] = []
          const tool = yield* (yield* WriteTool).init()
          yield* tool.execute({ filePath: path.join(test.directory, target), content: "x" }, context(asked))
          expect(editPatterns(asked)).toEqual([".local/test/test.md"])
        }),
      { git },
    )

    it.instance(
      `edit asks with a path relative to the workspace ${label}`,
      () =>
        Effect.gen(function* () {
          const test = yield* TestInstance
          const asked: Asked[] = []
          const tool = yield* (yield* EditTool).init()
          yield* tool.execute(
            { filePath: path.join(test.directory, target), oldString: "", newString: "x" },
            context(asked),
          )
          expect(editPatterns(asked)).toEqual([".local/test/test.md"])
        }),
      { git },
    )

    it.instance(
      `apply_patch asks with a path relative to the workspace ${label}`,
      () =>
        Effect.gen(function* () {
          const asked: Asked[] = []
          const tool = yield* (yield* ApplyPatchTool).init()
          yield* tool.execute(
            { patchText: "*** Begin Patch\n*** Add File: .local/test/test.md\n+x\n*** End Patch" },
            context(asked),
          )
          expect(editPatterns(asked)).toEqual([".local/test/test.md"])
        }),
      { git },
    )
  }
})
