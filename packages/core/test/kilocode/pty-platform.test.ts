import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Config } from "@opencode-ai/core/config"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { Pty } from "@opencode-ai/core/pty"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Deferred, Effect, Layer, Queue } from "effect"
import os from "node:os"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"

const directory = os.tmpdir()
const layer = AppNodeBuilder.build(LayerNode.group([Pty.node, EventV2.node]), [
  [Config.node, Layer.mock(Config.Service)({ entries: () => Effect.succeed([]) })],
  [
    Location.node,
    Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
  ],
])
const it = testEffect(layer)

async function alive(pid: number) {
  if (process.platform !== "win32") {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  const proc = Bun.spawn(["tasklist", "/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
    stdout: "pipe",
    stderr: "ignore",
    windowsHide: true,
  })
  const output = await new Response(proc.stdout).text()
  await proc.exited
  return output.includes(`"${pid}"`)
}

const attach = Effect.fn("PtyPlatformTest.attach")(function* (id: Pty.Info["id"]) {
  const pty = yield* Pty.Service
  const output = yield* Queue.unbounded<string>()
  const ended = yield* Deferred.make<{ exitCode?: number }>()
  const attachment = yield* pty.attach(id, {
    onData: (data) => Queue.offerUnsafe(output, data),
    onEnd: (event) => Deferred.doneUnsafe(ended, Effect.succeed(event)),
  })
  attachment.activate()
  return { attachment, output, ended }
})

describe("cross-platform PTY", () => {
  it.live("starts the default shell and exits from input", () =>
    Effect.gen(function* () {
      const pty = yield* Pty.Service
      const info = yield* Effect.acquireRelease(pty.create({ cwd: directory }), (item) =>
        pty.remove(item.id).pipe(Effect.ignore),
      )
      const terminal = yield* attach(info.id)
      terminal.attachment.write("exit\r")
      expect(yield* Deferred.await(terminal.ended).pipe(Effect.timeout("15 seconds"))).toEqual({ exitCode: 0 })
    }),
  )

  it.live("terminates a spawned process tree", () =>
    Effect.gen(function* () {
      const pty = yield* Pty.Service
      const source = [
        'const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {',
        '  stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true,',
        "})",
        "process.stdout.write(`CHILD:${child.pid}\\n`)",
        "setInterval(() => {}, 1000)",
      ].join("\n")
      const info = yield* Effect.acquireRelease(
        pty.create({ command: process.execPath, args: ["-e", source], cwd: directory }),
        (item) => pty.remove(item.id).pipe(Effect.ignore),
      )
      const terminal = yield* attach(info.id)
      const output = yield* Effect.gen(function* () {
        let text = ""
        while (!text.includes("CHILD:")) text += yield* Queue.take(terminal.output)
        return text
      }).pipe(Effect.timeout("15 seconds"))
      const pid = Number(output.match(/CHILD:(\d+)/)?.[1])
      expect(pid).toBeGreaterThan(0)

      yield* pty.remove(info.id)
      expect(yield* Effect.promise(() => alive(pid))).toBe(false)
    }),
  )
})
