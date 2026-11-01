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
import { pollWithTimeout, testEffect } from "../lib/effect"

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

// A later call that always runs its hooks, to tell when a background hook of an earlier call would have run.
const LAST = "call_last"

const runs = async (file: string) => (await lines(file)).filter((item) => item.tool_use_id !== LAST)

// Waits until a hook recorded the call `id` in `file`, and returns the runs of the calls under test.
const recorded = (file: string, id: string) =>
  pollWithTimeout(
    Effect.promise(async () => ((await lines(file)).some((item) => item.tool_use_id === id) ? runs(file) : undefined)),
    `no hook recorded ${id} in ${path.basename(file)}`,
  )

// Runs a command through the shell tool, then its result through the hooks, as a model step does.
// `abort` aborts the call's signal before the shell runs, or after it returned and before the hooks.
// An aborted signal kills the hooks a call waits for, so then the hooks run in the background: the
// returned runs are the ones recorded once a later call's hooks ran, and `files` is where to wait.
const bash = Effect.fn("test.bash")(function* (
  command: string,
  opts: { timeout?: number; abort?: "before" | "after" } = {},
) {
  const dir = yield* tmpdirScoped()
  const failure = path.join(dir, "failure")
  const success = path.join(dir, "success")
  const back = opts.abort !== undefined
  const handler = (file: string): KiloHooks.Handler => ({ ...record(file), ...(back ? { async: true } : {}) })
  const hooks: KiloHooks.Hooks = {
    PostToolUseFailure: [{ hooks: [handler(failure)] }],
    PostToolUse: [{ hooks: [handler(success)] }],
  }
  const abort = new AbortController()
  if (opts.abort === "before") abort.abort()
  const info = yield* ShellTool
  const tool = yield* info.init()
  const result = yield* tool.execute(
    { command, description: "test", ...(opts.timeout === undefined ? {} : { timeout: opts.timeout }) },
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
  if (opts.abort === "after") abort.abort()
  const output = { ...result }
  const call = {
    tool: "bash",
    args: { command },
    callID: "call_shell",
    sessionID: "ses_hooks_shell",
    directory: root,
  }
  yield* KiloHookTool.after(hooks, { ...call, abort: abort.signal }, output)
  if (back) {
    yield* KiloHookTool.after(hooks, { ...call, callID: LAST }, { output: "ok", metadata: { exit: 0 } })
    yield* recorded(success, LAST)
  }
  return {
    result,
    output: output.output,
    failure: yield* Effect.promise(() => runs(failure)),
    success: yield* Effect.promise(() => runs(success)),
    files: { failure, success },
  }
})

describe("bash hooks with the real shell tool", () => {
  it.live(
    "runs PostToolUseFailure, not PostToolUse, for a command killed at its timeout",
    () =>
      provideInstance(root)(
        Effect.gen(function* () {
          const run = yield* bash(cmd(`${bin} -e "setTimeout(() => {}, 60000)"`), { timeout: 300 })
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

  it.live(
    "still runs PostToolUseFailure for a timed-out command whose signal aborted after the shell returned",
    () =>
      provideInstance(root)(
        Effect.gen(function* () {
          const run = yield* bash(cmd(`${bin} -e "setTimeout(() => {}, 60000)"`), { timeout: 300, abort: "after" })
          expect(run.result.metadata.exit).toBeNull()
          expect(run.result.output).not.toContain("User aborted the command")
          const failure = yield* recorded(run.files.failure, "call_shell")
          expect(failure).toHaveLength(1)
          expect(String(failure[0]?.error)).toStartWith("Command timed out after 300 ms\n")
          expect(failure[0]?.is_interrupt).toBe(false)
          expect(run.success).toEqual([])
        }),
      ),
    15_000,
  )

  it.live(
    "runs neither hook for a command the user aborted",
    () =>
      provideInstance(root)(
        Effect.gen(function* () {
          const run = yield* bash(cmd(`${bin} -e "setTimeout(() => {}, 60000)"`), { abort: "before" })
          expect(run.result.metadata.exit).toBeNull()
          expect(run.result.output).toEndWith("<shell_metadata>\nUser aborted the command\n</shell_metadata>")
          expect(run.success).toEqual([])
          expect(run.failure).toEqual([])
        }),
      ),
    15_000,
  )

  it.live("keeps the hooks of a command that exited when its signal aborts before the hooks run", () =>
    provideInstance(root)(
      Effect.gen(function* () {
        const good = yield* bash(cmd(`${bin} -e "console.log('fine')"`), { abort: "after" })
        expect(good.result.metadata.exit).toBe(0)
        expect(yield* recorded(good.files.success, "call_shell")).toHaveLength(1)
        expect(good.failure).toEqual([])
        const bad = yield* bash(cmd(`${bin} -e "process.exit(3)"`), { abort: "after" })
        expect(bad.result.metadata.exit).not.toBe(0)
        expect(yield* recorded(bad.files.failure, "call_shell")).toHaveLength(1)
        expect(bad.success).toEqual([])
      }),
    ),
  )

  it.live("keeps PostToolUse for a command that exits zero and PostToolUseFailure for a non-zero exit", () =>
    provideInstance(root)(
      Effect.gen(function* () {
        const good = yield* bash(cmd(`${bin} -e "console.log('fine')"`))
        expect(good.result.metadata.exit).toBe(0)
        expect(good.failure).toEqual([])
        expect(good.success).toHaveLength(1)
        // PowerShell exits 1 for a failed native command, not with its code.
        const bad = yield* bash(cmd(`${bin} -e "process.exit(3)"`))
        expect(bad.result.metadata.exit).not.toBe(0)
        expect(bad.success).toEqual([])
        expect(String(bad.failure[0]?.error)).toStartWith(`Exit code ${bad.result.metadata.exit}\n`)
        expect(bad.failure[0]?.is_interrupt).toBe(false)
      }),
    ),
  )
})
