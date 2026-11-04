import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Location } from "@opencode/core/location"
import { Pty } from "@opencode/core/pty"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Pty.node, Bus.node]), [
    Location.node.replace(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/tmp") }))),
    ),
  ]),
)
const ptyTest = process.platform === "win32" ? it.live.skip : it.live

describe("pty replay of exited sessions", () => {
  ptyTest("replays the retained output of an exited session, then ends with its exit code", () =>
    Effect.gen(function* () {
      const pty = yield* Pty.Service
      const info = yield* Effect.acquireRelease(
        pty.create({
          command: "sh",
          args: ["-c", 'printf "replayed"; exit 7'],
          cwd: "/tmp",
          env: { TERM: "xterm-256color" },
        }),
        (created) => pty.remove(created.id).pipe(Effect.ignore),
      )
      yield* Effect.gen(function* () {
        while ((yield* pty.get(info.id)).status !== "exited") yield* Effect.sleep("20 millis")
      }).pipe(Effect.timeout("5 seconds"))

      const ended = yield* Deferred.make<{ exitCode?: number }>()
      const attachment = yield* pty.attach(info.id, {
        allowExited: true,
        onData: () => {},
        onEnd: (event) => Deferred.doneUnsafe(ended, Effect.succeed(event)),
      })
      expect(attachment.replay).toContain("replayed")
      attachment.activate()
      expect(yield* Deferred.await(ended).pipe(Effect.timeout("5 seconds"))).toEqual({ exitCode: 7 })
      attachment.detach()
    }),
  )
})
