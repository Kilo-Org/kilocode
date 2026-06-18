import { describe, expect, test } from "bun:test"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Session as SessionNs } from "@/session/session"
import { AppRuntime } from "../../../src/effect/app-runtime"
import { KiloSession } from "../../../src/kilocode/session"
import { provideTestInstance } from "../../fixture/fixture"
import type { SessionID } from "../../../src/session/schema"

const projectRoot = path.join(__dirname, "../../..")
void Log.init({ print: false })

function create(input?: SessionNs.CreateInput) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create(input)))
}

function remove(id: SessionID) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.remove(id)))
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
})
