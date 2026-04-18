// regression test for bash permission metadata.command
import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Shell } from "../../src/shell/shell"
import { SessionID, MessageID } from "../../src/session/schema"
import type { Permission } from "../../src/permission"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "../../src/tool/truncate"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { AppFileSystem } from "../../src/filesystem"
import { Plugin } from "../../src/plugin"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Plugin.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

Shell.acceptable.reset()

const baseCtx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const capture = (requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">>) => ({
  ...baseCtx,
  ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
    Effect.sync(() => {
      requests.push(req)
    }),
})

describe("bash permission metadata.command", () => {
  test("permission prompt shows raw command without tool name prefix", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await runtime.runPromise(BashTool.pipe(Effect.flatMap((info) => info.init())))
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const command = "echo hello"
        await Effect.runPromise(bash.execute({ command, description: "Echo hello" }, capture(requests)))

        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeDefined()
        expect(bashReq!.metadata.command).toBe(command)
      },
    })
  })
})
