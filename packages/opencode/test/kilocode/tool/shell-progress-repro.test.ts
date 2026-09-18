import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import type * as Scope from "effect/Scope"
import path from "path"
import { Config } from "@/config/config"
import { ShellTool } from "@/tool/shell"
import { provideInstance, testInstanceStoreLayer } from "../../fixture/fixture"
import { Agent } from "@/agent/agent"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "@/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Plugin } from "@/plugin"
import { testEffect } from "../../lib/effect"
import type { Tool } from "@/tool/tool"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceStore } from "@/project/instance-store"

const shellLayer = Layer.mergeAll(
  LayerNode.compile(
    LayerNode.group([
      CrossSpawnSpawner.node,
      FSUtil.node,
      Plugin.node,
      Truncate.node,
      Config.node,
      Agent.node,
      RuntimeFlags.node,
    ]),
  ),
  testInstanceStoreLayer,
)
const it = testEffect(shellLayer)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const projectRoot = path.join(__dirname, "../../..")

describe("repro: shell tool metadata volume", () => {
  it.live("counts metadata updates for a chunk-heavy command", () =>
    Effect.gen(function* () {
      const info = yield* ShellTool
      const tool = yield* info.init()
      let calls = 0
      const result = yield* tool.execute(
        { command: `${process.execPath} -e "for(let i=0;i<2000;i++)process.stdout.write(i+String.fromCharCode(10))"` },
        {
          ...ctx,
          metadata: () =>
            Effect.sync(() => {
              calls += 1
            }),
        },
      )
      console.log("REPRO metadata calls:", calls, "output bytes:", result.output.length)
      expect(calls).toBeGreaterThan(0)
    }).pipe(provideInstance(projectRoot)),
  )
})
