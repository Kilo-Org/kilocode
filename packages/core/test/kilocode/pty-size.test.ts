import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer, Queue } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Location } from "@opencode/core/location"
import { Pty } from "@opencode/core/pty"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/tmp") })),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Pty.node, Bus.node]), [Location.node.replace(locationLayer)]),
)
const ptyTest = process.platform === "win32" ? it.live.skip : it.live

const collect = Effect.fn("PtySizeTest.collect")(function* (id: Pty.ID) {
  const pty = yield* Pty.Service
  const output = yield* Queue.unbounded<string>()
  const ended = yield* Deferred.make<{ exitCode?: number }>()
  const attachment = yield* pty.attach(id, {
    cursor: 0,
    onData: (chunk) => Queue.offerUnsafe(output, chunk),
    onEnd: (event) => Deferred.doneUnsafe(ended, Effect.succeed(event)),
  })
  attachment.activate()
  return output
})

const waitForOutput = (output: Queue.Queue<string>, text: string) =>
  Effect.gen(function* () {
    let received = ""
    while (!received.includes(text)) received += yield* Queue.take(output)
    return received
  }).pipe(
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.fail(new Error(`timeout waiting for output containing ${JSON.stringify(text)}`)),
    }),
  )

describe("pty create size", () => {
  ptyTest("the shell starts at the requested size instead of 80 columns", () =>
    Effect.gen(function* () {
      const pty = yield* Pty.Service
      const info = yield* Effect.acquireRelease(
        pty.create({
          command: "/bin/sh",
          args: ["-c", "stty size"],
          cwd: "/tmp",
          size: { cols: 100, rows: 30 },
          env: { TERM: "xterm-256color", OPENCODE_TERMINAL: "1" },
        }),
        (created) => pty.remove(created.id).pipe(Effect.ignore),
      )
      const output = yield* collect(info.id)
      expect(yield* waitForOutput(output, "30 100")).toContain("30 100")
    }),
  )
})
