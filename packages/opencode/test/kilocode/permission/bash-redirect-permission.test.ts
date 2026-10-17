import { describe, expect, test } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Effect, Layer, ManagedRuntime } from "effect"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { ShellTool, ShellPermission } from "../../../src/tool/shell"
import { provideTestInstance, tmpdir } from "../../fixture/fixture"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Plugin } from "../../../src/plugin"
import { Truncate } from "../../../src/tool/truncate"
import { Agent } from "../../../src/agent/agent"
import { Config } from "../../../src/config/config"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"

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

describe("bash permission redirect handling and error attribution", () => {
  test("DeniedError message distinguishes agent, global, and user sources", () => {
    const agentErr = new PermissionV1.DeniedError({
      ruleset: { permission: "bash", pattern: "*>*", action: "deny", source: "agent" },
    })
    expect(agentErr.message).toContain("This agent's policy prevents you from using this specific tool call.")

    const globalErr = new PermissionV1.DeniedError({
      ruleset: [{ permission: "bash", pattern: "*", action: "deny", source: "global" }],
    })
    expect(globalErr.message).toContain("A global policy prevents you from using this specific tool call.")

    const userErr = new PermissionV1.DeniedError({
      ruleset: { permission: "bash", pattern: "rm -rf *", action: "deny", source: "user" },
    })
    expect(userErr.message).toContain("The user has specified a rule which prevents you from using this specific tool call.")

    const fallbackErr = new PermissionV1.DeniedError({
      ruleset: { permission: "bash", pattern: "*", action: "deny" },
    })
    expect(fallbackErr.message).toContain("The user has specified a rule which prevents you from using this specific tool call.")
  })

  test("safe descriptor redirect 2>&1 strips redirect from evaluated pattern", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const perm = await runtime.runPromise(ShellPermission)
        const res = await runtime.runPromise(
          perm.decompose({
            command: "ls -la ~/.kilo/plans 2>&1",
            cwd: tmp.path,
            shell: "bash",
          }),
        )
        expect(res.patterns).toContain("ls -la ~/.kilo/plans")
        expect(res.patterns.some((p) => p.includes("2>&1"))).toBe(false)
      },
    })
  })

  test("unsafe file redirect retains redirect in pattern", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const perm = await runtime.runPromise(ShellPermission)
        const res = await runtime.runPromise(
          perm.decompose({
            command: "ls > output.txt 2>&1",
            cwd: tmp.path,
            shell: "bash",
          }),
        )
        expect(res.patterns.some((p) => p.includes(">"))).toBe(true)
      },
    })
  })
})
