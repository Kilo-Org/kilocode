import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Bus } from "@/bus"
import { Session as SessionNs } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { AppRuntime, type AppServices } from "../../../src/effect/app-runtime"
import { KiloSession } from "../../../src/kilocode/session"
import { provideTestInstance } from "../../fixture/fixture"
import { MessageID, type SessionID } from "../../../src/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
const projectRoot = path.join(__dirname, "../../..")
void Log.init({ print: false })

function run<A, E, R extends AppServices>(effect: Effect.Effect<A, E, R>) {
  return AppRuntime.runPromise(effect)
}

function create(input?: SessionNs.CreateInput) {
  return run(SessionNs.Service.use((svc) => svc.create(input)))
}

function seed(id: SessionID) {
  return run(
    SessionNs.Service.use((svc) =>
      Effect.gen(function* () {
        const user = yield* svc.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: id,
          agent: "build",
          model: { modelID: ModelV2.ID.make("test-model"), providerID: ProviderV2.ID.make("test") },
          time: { created: Date.now() },
        })
        yield* svc.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          parentID: user.id,
          sessionID: id,
          mode: "build",
          agent: "build",
          cost: 0,
          path: { cwd: projectRoot, root: projectRoot },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelV2.ID.make("test-model"),
          providerID: ProviderV2.ID.make("test"),
          time: { created: Date.now() },
          finish: "stop",
        })
      }),
    ),
  )
}

function remove(id: SessionID) {
  return run(SessionNs.Service.use((svc) => svc.remove(id)))
}

describe("session platform attribution", () => {
  test("child sessions inherit the root platform override", async () => {
    await provideTestInstance({
      directory: projectRoot,
      fn: async () => {
        const root = await create({ platform: "agent-manager" })
        const child = await create({ parentID: root.id, title: "child" })
        const attr = KiloSession.attribution(child.id)

        expect(KiloSession.getPlatformOverride(root.id)).toBe("agent-manager")
        expect(KiloSession.getPlatformOverride(child.id)).toBe("agent-manager")
        expect(KiloSession.resolvePlatform(child.id)).toBe("agent-manager")
        expect(attr.rootID).toBe(root.id)
        expect(attr.feature).toBe("agent-manager")

        await remove(root.id)
      },
    })
  })

  test("child sessions expose parent and root lineage", async () => {
    await provideTestInstance({
      directory: projectRoot,
      fn: async () => {
        const root = await create({})
        const child = await create({ parentID: root.id, title: "child" })
        const leaf = await create({ parentID: child.id, title: "leaf" })

        expect(KiloSession.resolveParent(root.id)).toBeUndefined()
        expect(KiloSession.resolveParent(child.id)).toBe(root.id)
        expect(KiloSession.resolveParent(leaf.id)).toBe(child.id)
        expect(KiloSession.resolveRoot(leaf.id)).toBe(root.id)

        await remove(root.id)
      },
    })
  })

  test("turn close events include persisted parent lineage", async () => {
    await provideTestInstance({
      directory: projectRoot,
      fn: async () => {
        const root = await create({})
        const child = await create({ parentID: root.id, title: "child" })
        await seed(child.id)
        KiloSession.clearPlatformOverride(child.id)
        expect(KiloSession.resolveParent(child.id)).toBeUndefined()

        const closed = Promise.withResolvers<SessionID | undefined>()
        const unsubscribe = Bus.subscribe(KiloSession.Event.TurnClose, (event) => {
          if (event.properties.sessionID === child.id) closed.resolve(event.properties.parentID)
        })

        await run(SessionPrompt.Service.use((prompt) => prompt.loop({ sessionID: child.id })))
        expect(await closed.promise).toBe(root.id)
        unsubscribe()
        await remove(root.id)
      },
    })
  })
})
