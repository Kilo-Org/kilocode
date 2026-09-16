import "./action-gate-shell.setup" // MUST be first: sets KILO_ACTION_GATE=1 before shell/action-gate load
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import path from "node:path"
import { ShellTool } from "../../src/tool/shell"
import { provideTestInstance, tmpdir } from "../fixture/fixture"
import { Shell } from "@opencode-ai/core/shell"
import { SessionID, MessageID } from "../../src/session/schema"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "../../src/tool/truncate"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Plugin } from "../../src/plugin"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"

// Integration regression for the deterministic rm-tripwire, through the REAL ShellTool permission path
// (tree-sitter parse + argpath resolution) — not a stand-in. A blocked destructive rm surfaces as a
// thrown "Blocked destructive recursive delete" error during the permission phase, BEFORE the command runs.

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    AppNodeBuilder.build(CrossSpawnSpawner.node),
    AppNodeBuilder.build(FSUtil.node),
    AppNodeBuilder.build(Plugin.node),
    AppNodeBuilder.build(Truncate.node),
    AppNodeBuilder.build(Agent.node),
    AppNodeBuilder.build(Config.node),
    RuntimeFlags.layer(),
  ),
)

Shell.acceptable.reset()

const ctx = {
  sessionID: SessionID.make("ses_gate"),
  messageID: MessageID.make("msg_gate"),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void, // auto-approve the (non-blocked) bash permission ask
}

const TRIPWIRE = /Blocked destructive recursive delete/

describe.skipIf(process.platform === "win32")("ActionGate tripwire — real shell permission path", () => {
  const withBash = (dir: string, fn: (bash: Awaited<ReturnType<typeof init>>) => Promise<void>) =>
    provideTestInstance({ directory: dir, fn: () => init().then(fn) })
  const init = () => runtime.runPromise(ShellTool.pipe(Effect.flatMap((info) => info.init())))
  const run = (bash: Awaited<ReturnType<typeof init>>, command: string) =>
    Effect.runPromise(bash.execute({ command }, ctx))

  test("rm -rf . (the workspace/cwd itself) is blocked", async () => {
    await using tmp = await tmpdir()
    await withBash(tmp.path, async (bash) => {
      await expect(run(bash, "rm -rf .")).rejects.toThrow(TRIPWIRE)
    })
  })

  test("cd .. && rm -rf <workspace-basename> bypass is blocked (relative rm after a cwd change fails closed)", async () => {
    await using tmp = await tmpdir()
    const base = path.basename(tmp.path)
    await withBash(tmp.path, async (bash) => {
      await expect(run(bash, `cd .. && rm -rf ${base}`)).rejects.toThrow(TRIPWIRE)
    })
  })

  test("nested wrappers: env x5 -> rm -rf / is blocked", async () => {
    await using tmp = await tmpdir()
    await withBash(tmp.path, async (bash) => {
      await expect(run(bash, "env A=1 env A=2 env A=3 env A=4 env A=5 rm -rf /")).rejects.toThrow(TRIPWIRE)
    })
  })

  test("scoped rm -rf build inside the project is ALLOWED (not the tripwire)", async () => {
    await using tmp = await tmpdir()
    await withBash(tmp.path, async (bash) => {
      // rm -rf on a missing subdir is a no-op under -f; the point is the tripwire must NOT fire.
      await run(bash, "rm -rf build").catch((err) => {
        if (TRIPWIRE.test(String(err))) throw new Error("scoped rm -rf build was wrongly blocked")
      })
    })
  })

  test("rm -rf build && cd .. is ALLOWED (prefix-aware: the cwd change is AFTER the relative rm)", async () => {
    await using tmp = await tmpdir()
    await withBash(tmp.path, async (bash) => {
      await run(bash, "rm -rf build && cd ..").catch((err) => {
        if (TRIPWIRE.test(String(err))) throw new Error("rm -rf build was wrongly blocked by a later cd")
      })
    })
  })

  test("an absolute in-project rm -rf <cwd>/build is ALLOWED even in a cwd-changing chain", async () => {
    await using tmp = await tmpdir()
    await withBash(tmp.path, async (bash) => {
      await run(bash, `cd sub 2>/dev/null; rm -rf ${path.join(tmp.path, "build")}`).catch((err) => {
        if (TRIPWIRE.test(String(err))) throw new Error("absolute in-project rm was wrongly blocked")
      })
    })
  })
})
