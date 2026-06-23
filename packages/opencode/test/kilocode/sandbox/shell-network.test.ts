import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Plugin } from "@/plugin"
import { Agent } from "@/agent/agent"
import { ShellTool } from "@/tool/shell"
import { Truncate } from "@/tool/truncate"
import { MessageID, SessionID } from "@/session/schema"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { run as runSandbox, type Profile } from "@kilocode/sandbox"
import { provideInstance, tmpdirScoped } from "../../fixture/fixture"

const layer = Layer.mergeAll(
  CrossSpawnSpawner.defaultLayer,
  AppFileSystem.defaultLayer,
  Plugin.defaultLayer,
  Truncate.defaultLayer,
  Config.defaultLayer,
  Agent.defaultLayer,
  RuntimeFlags.defaultLayer,
)

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

describe("model shell network integration", () => {
  test.skipIf(process.platform !== "darwin")(
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
        expect(deny.output).toContain("Operation not permitted")
        expect(deny.metadata.exit).not.toBe(0)
        expect(denied.accepted()).toBe(0)
      })

      await Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(layer))))
    },
  )
})
