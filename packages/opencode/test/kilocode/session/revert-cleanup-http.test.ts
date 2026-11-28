import { afterEach, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { Session } from "@/session/session"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { MessageID, PartID } from "@/session/schema"
import { SessionPaths } from "@/server/routes/instance/httpapi/groups/session"
import { disposeAllInstances, provideInstance, TestInstance } from "../../fixture/fixture"
import { resetDatabase } from "../../fixture/db"
import { pollWithTimeout, testEffectShared } from "../../lib/effect"
import { httpApiLayer, requestInDirectory } from "../../server/httpapi-layer"
import fs from "node:fs/promises"
import path from "node:path"

const it = testEffectShared(
  Layer.mergeAll(
    AppNodeBuilderV1.build(
      LayerNode.group([
        Session.node,
        SessionRevert.node,
        SessionRunState.node,
        SessionProjector.node,
        CrossSpawnSpawner.node,
      ]),
    ),
    httpApiLayer,
  ),
)

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

it.instance(
  "prompt, summarize, and shell return client errors when revert cleanup finds a busy descendant",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const sessions = yield* Session.Service
      const revert = yield* SessionRevert.Service
      const run = yield* SessionRunState.Service
      const parent = yield* sessions.create({})
      const prompt = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: parent.id,
        agent: "build",
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        time: { created: Date.now() },
      })
      const subdir = path.join(test.directory, "child")
      yield* sessions.updatePart({
        id: PartID.ascending(),
        sessionID: parent.id,
        messageID: prompt.id,
        type: "text",
        text: "edit",
      })
      yield* Effect.promise(() => fs.mkdir(subdir))
      const child = yield* sessions.create({ parentID: parent.id }).pipe(provideInstance(subdir))
      const undone = yield* revert.revert({ sessionID: parent.id, messageID: prompt.id })
      expect(undone.revert?.messageID).toBe(prompt.id)
      const fiber = yield* run
        .ensureRunning(child.id, Effect.never, Effect.never)
        .pipe(provideInstance(subdir), Effect.forkChild)
      yield* pollWithTimeout(
        run.assertNotBusy(child.id).pipe(
          provideInstance(subdir),
          Effect.as(undefined),
          Effect.catchTag("SessionBusyError", () => Effect.succeed(true)),
        ),
        "child never became busy",
      )
      for (const [endpoint, payload, status] of [
        [SessionPaths.prompt, { parts: [], noReply: true }, 400],
        [SessionPaths.summarize, { providerID: "test", modelID: "test" }, 400],
        [SessionPaths.shell, { agent: "build", command: "echo should-not-run" }, 409],
      ] as const) {
        const response = yield* requestInDirectory(endpoint.replace(":sessionID", parent.id), test.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
        expect(response.status).toBe(status)
        expect(yield* response.text).not.toContain("Unexpected server error")
        expect((yield* sessions.get(parent.id)).revert).toEqual(undone.revert)
        expect((yield* sessions.messages({ sessionID: parent.id })).map((msg) => msg.info.id)).toEqual([prompt.id])
      }
      yield* run.assertNotBusy(parent.id)
      yield* run.cancel(child.id).pipe(provideInstance(subdir))
      yield* Fiber.interrupt(fiber)
    }),
  { git: true, config: { formatter: false, lsp: false } },
  30_000,
)
