import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Shell } from "@opencode-ai/core/shell"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { KiloHooks } from "@/kilocode/hooks/hooks"
import { KiloHookTool } from "@/kilocode/hooks/tool"
import { Plugin } from "@/plugin"
import { MessageID, SessionID } from "@/session/schema"
import { ShellTool } from "@/tool/shell"
import { Truncate } from "@/tool/truncate"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// The real shell tool's results through the bash PostToolUse / PostToolUseFailure choice.

const it = testEffect(
  Layer.mergeAll(
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
  ),
)

Shell.acceptable.reset()
const bin = `"${process.execPath.replaceAll("\\", "/")}"`
const root = path.join(__dirname, "../..")
// PowerShell needs the call operator before a quoted executable path that takes arguments.
const cmd = (text: string) => (["pwsh", "powershell"].includes(Shell.name(Shell.acceptable())) ? `& ${text}` : text)

const record = (file: string): KiloHooks.Handler => ({
  type: "command",
  command: process.execPath,
  args: [
    "-e",
    `const fs = require('fs'); fs.appendFileSync(${JSON.stringify(file)}, fs.readFileSync(0, 'utf8').trim() + '\\n')`,
  ],
})

const lines = async (file: string) =>
  (await Bun.file(file).exists())
    ? (await Bun.file(file).text())
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : []

// Runs a command through the shell tool, then its result through the hooks, as a model step does.
const bash = Effect.fn("test.bash")(function* (command: string, timeout?: number) {
  const dir = yield* tmpdirScoped()
  const failure = path.join(dir, "failure")
  const success = path.join(dir, "success")
  const hooks: KiloHooks.Hooks = {
    PostToolUseFailure: [{ hooks: [record(failure)] }],
    PostToolUse: [{ hooks: [record(success)] }],
  }
  const abort = new AbortController()
  const info = yield* ShellTool
  const tool = yield* info.init()
  const result = yield* tool.execute(
    { command, description: "test", ...(timeout === undefined ? {} : { timeout }) },
    {
      sessionID: SessionID.make("ses_hooks_shell"),
      messageID: MessageID.make("msg_hooks_shell"),
      callID: "call_shell",
      agent: "code",
      abort: abort.signal,
      messages: [],
      metadata: () => Effect.void,
      ask: () => Effect.void,
    },
  )
  const output = { ...result }
  yield* KiloHookTool.after(
    hooks,
    {
      tool: "bash",
      args: { command },
      callID: "call_shell",
      sessionID: "ses_hooks_shell",
      directory: root,
      abort: abort.signal,
    },
    output,
  )
  return {
    result,
    output: output.output,
    failure: yield* Effect.promise(() => lines(failure)),
    success: yield* Effect.promise(() => lines(success)),
  }
})

describe("bash hooks with the real shell tool", () => {
  it.live(
    "runs PostToolUseFailure, not PostToolUse, for a command killed at its timeout",
    () =>
      provideInstance(root)(
        Effect.gen(function* () {
          const run = yield* bash(cmd(`${bin} -e "setTimeout(() => {}, 60000)"`), 300)
          expect(run.result.metadata.exit).toBeNull()
          expect(run.success).toEqual([])
          expect(run.failure).toHaveLength(1)
          expect(run.failure[0]?.hook_event_name).toBe("PostToolUseFailure")
          expect(String(run.failure[0]?.error)).toStartWith("Command timed out after 300 ms\n")
          expect(run.failure[0]?.is_interrupt).toBe(false)
        }),
      ),
    15_000,
  )

  it.live("keeps PostToolUse for a command that exits zero and PostToolUseFailure for a non-zero exit", () =>
    provideInstance(root)(
      Effect.gen(function* () {
        const good = yield* bash(cmd(`${bin} -e "console.log('fine')"`))
        expect(good.result.metadata.exit).toBe(0)
        expect(good.failure).toEqual([])
        expect(good.success).toHaveLength(1)
        const bad = yield* bash(cmd(`${bin} -e "process.exit(3)"`))
        expect(bad.success).toEqual([])
        expect(String(bad.failure[0]?.error)).toStartWith("Exit code 3\n")
        expect(bad.failure[0]?.is_interrupt).toBe(false)
      }),
    ),
  )
})
