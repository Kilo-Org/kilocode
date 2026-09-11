import { describe, expect, test } from "bun:test"
import { Effect, Layer, Result, Schema } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import * as AppProcess from "@opencode-ai/core/process"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { BackgroundProcess } from "@/kilocode/background-process"
import { BackgroundProcessTool, Params } from "@/kilocode/tool/background-process"
import { Permission } from "@/permission"
import { MessageID, SessionID } from "@/session/schema"
import { Truncate } from "@/tool/truncate"
import type * as Tool from "@/tool/tool"
import { toJsonSchema } from "@opencode-ai/core/effect-zod"
import { testEffect } from "../lib/effect"

const accepts = (input: unknown) => Result.isSuccess(Schema.decodeUnknownResult(Params)(input))

describe("BackgroundProcessTool", () => {
  test("emits a root object JSON schema", () => {
    const json = toJsonSchema(Params) as { type?: unknown; anyOf?: unknown; properties?: Record<string, unknown> }

    expect(json.type).toBe("object")
    expect(json.anyOf).toBeUndefined()
    expect(json.properties?.action).toEqual(
      expect.objectContaining({ enum: ["start", "list", "status", "logs", "stop", "restart"] }),
    )
  })

  test("validates action-specific required fields", () => {
    expect(accepts({ action: "list" })).toBe(true)
    expect(accepts({ action: "start", command: "bun run dev", ready: { pattern: "ready" } })).toBe(true)
    expect(accepts({ action: "start", command: "bun run dev", inherit: true })).toBe(true)
    expect(accepts({ action: "start", command: "bun run dev", persistent: true })).toBe(true)
    expect(accepts({ action: "start", command: "bun run dev", inherit: true, persistent: true })).toBe(false)
    expect(accepts({ action: "start" })).toBe(false)
    expect(accepts({ action: "stop", id: "bgp01" })).toBe(true)
    expect(accepts({ action: "stop", id: "bgp01", persistent: true })).toBe(false)
    expect(accepts({ action: "stop" })).toBe(false)
  })
})

// A restart stops and respawns a process, so it must go through the same permission boundary as a
// start. It previously performed the side effect before asking (spec §12.7).
const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(CrossSpawnSpawner.node),
    AppNodeBuilder.build(FSUtil.node),
    AppNodeBuilder.build(AppProcess.node),
    AppNodeBuilder.build(Config.node),
    AppNodeBuilder.build(EventV2Bridge.node),
    AppNodeBuilder.build(Truncate.node),
    AppNodeBuilder.build(Agent.node),
    Bus.layer,
  ),
)

const asked: Array<Parameters<Tool.Context["ask"]>[0]> = []

const context = (reply: "allow" | "reject"): Tool.Context => ({
  sessionID: SessionID.make("ses_restart"),
  messageID: MessageID.make("msg_restart"),
  callID: "call_restart",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  extra: {},
  ask: (req) =>
    Effect.suspend(() => {
      asked.push(req)
      return reply === "allow" ? Effect.void : Effect.die(new Permission.RejectedError())
    }),
})

const runRestart = (id: BackgroundProcess.ID, reply: "allow" | "reject") =>
  Effect.gen(function* () {
    const info = yield* BackgroundProcessTool
    return yield* (yield* info.init()).execute({ action: "restart", id }, context(reply))
  })

it.instance(
  "asks for permission before restarting a background process",
  Effect.gen(function* () {
    asked.length = 0
    const cwd = yield* InstanceState.directory
    const started = yield* Effect.promise(() =>
      BackgroundProcess.start({
        sessionID: SessionID.make("ses_restart"),
        command: `${process.execPath} -e "setInterval(() => {}, 1000)"`,
        cwd,
        lifetime: "session",
      }),
    )
    try {
      const exit = yield* runRestart(started.id, "reject").pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      expect(asked).toHaveLength(1)
      expect(asked[0]?.permission).toBe("bash")
      expect(asked[0]?.metadata?.["action"]).toBe("restart")
      const current = yield* Effect.promise(() => BackgroundProcess.get(started.id))
      expect(current?.pid).toBe(started.pid)
    } finally {
      yield* Effect.promise(() => BackgroundProcess.stop(started.id))
    }
  }),
  { git: true },
  20_000,
)
