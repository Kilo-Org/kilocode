import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as Network from "@/kilocode/sandbox/network"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
import { Plugin } from "@/plugin"
import { Agent } from "@/agent/agent"
import { ShellTool } from "@/tool/shell"
import { Truncate } from "@/tool/truncate"
import { MessageID, SessionID } from "@/session/schema"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { run as runSandbox, type Profile } from "@kilocode/sandbox"
import { TestConfig } from "../../fixture/config"
import { provideInstance, tmpdirScoped } from "../../fixture/fixture"

const base = Layer.mergeAll(
  CrossSpawnSpawner.defaultLayer,
  AppFileSystem.defaultLayer,
  Plugin.defaultLayer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
  RuntimeFlags.defaultLayer,
)
const layer = Layer.mergeAll(base, Config.defaultLayer)

function configured(restrict: boolean) {
  return Layer.mergeAll(
    base,
    TestConfig.layer({
      get: () =>
        Effect.succeed({
          sandbox: { enabled: true, network: restrict ? "deny" : "allow" },
        }),
    }),
  )
}

const ctx = {
  sessionID: SessionID.make("ses_sandbox_network"),
  messageID: MessageID.make("msg_sandbox_network"),
  callID: "call_sandbox_network",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

function profile(root: string, mode: Profile["network"]["mode"]): Profile {
  return {
    filesystem: {
      allowWrite: [{ path: root, kind: "subtree" }],
      denyWrite: [],
      denyNames: [".git"],
    },
    network: { mode, allowedHosts: [] },
    environment: { deny: [], set: {} },
  }
}

function server() {
  let accepted = 0
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        accepted++
        socket.write("model-shell-network-ok")
        socket.end()
      },
      data() {},
    },
  })
  return { listener, accepted: () => accepted }
}

const execute = Effect.fn("ShellNetworkTest.execute")(function* (
  root: string,
  mode: Profile["network"]["mode"],
  port: number,
) {
  const info = yield* ShellTool
  const shell = yield* info.init()
  return yield* runSandbox(profile(root, mode), shell.execute({ command: `/usr/bin/nc -v 127.0.0.1 ${port}` }, ctx))
})

const executeConfigured = Effect.fn("ShellNetworkTest.executeConfigured")(function* (
  port: number,
  sessionID = ctx.sessionID,
) {
  const info = yield* ShellTool
  const shell = yield* info.init()
  const tool = Network.builtin({ id: "bash" })
  return yield* SandboxPolicy.executeTool(
    sessionID,
    tool,
    shell.execute({ command: `/usr/bin/nc -v 127.0.0.1 ${port}` }, ctx),
  )
})

describe("model shell network integration", () => {
  test.skipIf(process.platform !== "darwin" && process.platform !== "linux")(
    "enforces allow and deny profiles through the actual shell tool and process spawner",
    async () => {
      const effect = Effect.gen(function* () {
        const root = yield* tmpdirScoped()
        const allowed = server()
        const denied = server()
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            allowed.listener.stop(true)
            denied.listener.stop(true)
          }),
        )

        const allow = yield* execute(root, "allow", allowed.listener.port).pipe(provideInstance(root))
        const deny = yield* execute(root, "deny", denied.listener.port).pipe(provideInstance(root))
        expect(allow.output).toContain("model-shell-network-ok")
        expect(allow.metadata.exit).toBe(0)
        expect(allowed.accepted()).toBe(1)
        if (process.platform === "darwin") expect(deny.output).toContain("Operation not permitted")
        expect(deny.output).not.toContain("model-shell-network-ok")
        expect(deny.metadata.exit).not.toBe(0)
        expect(denied.accepted()).toBe(0)
      })

      await Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(layer))))
    },
  )

  test.skipIf(process.platform !== "darwin" && process.platform !== "linux")(
    "honors configured shell network access without authenticated server control",
    async () => {
      const effect = Effect.gen(function* () {
        const root = yield* tmpdirScoped()
        const allowed = server()
        const denied = server()
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            allowed.listener.stop(true)
            denied.listener.stop(true)
          }),
        )

        const allow = yield* executeConfigured(allowed.listener.port, SessionID.make("ses_sandbox_network_allow")).pipe(
          provideInstance(root),
          Effect.provide(configured(false)),
        )
        const deny = yield* executeConfigured(denied.listener.port, SessionID.make("ses_sandbox_network_deny")).pipe(
          provideInstance(root),
          Effect.provide(configured(true)),
        )
        expect(allow.output).toContain("model-shell-network-ok")
        expect(allow.metadata.exit).toBe(0)
        expect(allowed.accepted()).toBe(1)
        expect(deny.output).not.toContain("model-shell-network-ok")
        expect(deny.metadata.exit).not.toBe(0)
        expect(denied.accepted()).toBe(0)
      })

      await Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(CrossSpawnSpawner.defaultLayer))))
    },
  )
})
