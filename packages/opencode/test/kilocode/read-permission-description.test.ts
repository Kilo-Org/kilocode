import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { InstanceState } from "../../src/effect/instance-state"
import { LSP } from "../../src/lsp/lsp"
import { Instruction } from "../../src/session/instruction"
import { MessageID, SessionID } from "../../src/session/schema"
import { ReadTool } from "../../src/tool/read"
import type { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(Agent.node),
    AppNodeBuilder.build(FSUtil.node),
    AppNodeBuilder.build(CrossSpawnSpawner.node),
    AppNodeBuilder.build(Instruction.node),
    AppNodeBuilder.build(LSP.node),
    AppNodeBuilder.build(Truncate.node),
    testInstanceStoreLayer,
  ),
)

describe("read permission descriptions", () => {
  it.instance("adds task context without changing external read scope", () =>
    Effect.gen(function* () {
      const ins = yield* InstanceState.context
      const dir = path.join(process.cwd(), ".test-external-" + Math.random().toString(36).slice(2))
      expect(FSUtil.contains(ins.directory, dir)).toBe(false)
      expect(FSUtil.contains(ins.worktree, dir)).toBe(false)
      const fs = yield* FSUtil.Service
      yield* Effect.addFinalizer(() => fs.remove(dir, { recursive: true, force: true }).pipe(Effect.ignore))
      const file = path.join(dir, "report.txt")
      yield* fs.writeWithDirs(file, "report contents")
      const tool = yield* (yield* ReadTool).init()
      const requests: Parameters<Tool.Context["ask"]>[0][] = []
      const ctx: Tool.Context = {
        sessionID: SessionID.make("ses_test"),
        messageID: MessageID.make("msg_test"),
        callID: "",
        agent: "code",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => Effect.void,
        ask: (request) => Effect.sync(() => void requests.push(request)),
      }
      const description = "Read the report to summarize its findings"

      yield* tool.execute({ filePath: file, description: ` ${description} ` }, ctx)

      expect(requests.map((request) => request.permission)).toEqual(["external_directory", "read"])
      expect(requests.at(0)?.metadata).toEqual({ filepath: file, parentDir: dir, description })
      expect(requests.at(0)?.always).toEqual(requests.at(0)?.patterns)
      expect(requests.at(1)?.metadata).toEqual({ description })
      expect(requests.at(1)?.always).toEqual(["*"])

      requests.length = 0
      yield* tool.execute({ filePath: file }, ctx)
      yield* tool.execute({ filePath: file, description: "  " }, ctx)
      expect(requests.map((request) => request.metadata)).toEqual([
        { filepath: file, parentDir: dir },
        {},
        { filepath: file, parentDir: dir },
        {},
      ])
    }),
  )
})
