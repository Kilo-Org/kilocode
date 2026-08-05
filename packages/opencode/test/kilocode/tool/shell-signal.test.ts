// Regression tests for Kilo-Org/kilocode#12677.
//
// A shell terminated by a signal (for example `bash -c` exec'ing a binary that
// then segfaults) produces no numeric exit code. The spawner used to fail the
// exit-code effect in that case, so the bash tool's race kept waiting for the
// abort or timeout branches and the call appeared to hang. The spawner now
// settles signal termination as the conventional 128 + signum code.

import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "../../../src/agent/agent"
import { Config } from "../../../src/config/config"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"
import { Plugin } from "../../../src/plugin"
import { SessionID, MessageID } from "../../../src/session/schema"
import { ShellTool } from "../../../src/tool/shell"
import { Truncate } from "../../../src/tool/truncate"
import { provideInstance, testInstanceStoreLayer } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const layer = Layer.mergeAll(
  AppNodeBuilder.build(CrossSpawnSpawner.node),
  AppNodeBuilder.build(FSUtil.node),
  AppNodeBuilder.build(Plugin.node),
  AppNodeBuilder.build(Truncate.node),
  AppNodeBuilder.build(Config.node),
  AppNodeBuilder.build(Agent.node),
  AppNodeBuilder.build(RuntimeFlags.node),
  testInstanceStoreLayer,
)
const it = testEffect(layer)

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

const root = path.join(__dirname, "../../..")

describe("shell tool signal termination", () => {
  if (process.platform !== "win32") {
    it.live("settles with 128 + signum when the shell dies from a signal", () =>
      provideInstance(root)(
        Effect.gen(function* () {
          const tool = yield* ShellTool
          const bash = yield* tool.init()
          const result = yield* bash
            .execute(
              {
                command: "kill -SEGV $$",
                description: "Terminate the shell with SIGSEGV",
                timeout: 60_000,
              },
              ctx,
            )
            .pipe(Effect.timeout("5 seconds"))
          expect(result.metadata.exit).toBe(128 + 11)
          expect(result.output).not.toContain("exceeding timeout")
        }),
      ),
    )
  }
})
