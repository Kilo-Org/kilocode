import { describe, expect, test } from "bun:test"
import path from "path"
import { Session as SessionNs } from "@/session/session"
import { Bus } from "../../../src/bus"
import * as Log from "@opencode-ai/core/util/log"
import { WithInstance } from "../../../src/project/with-instance"
import { AppRuntime } from "../../../src/effect/app-runtime"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"
import { Effect } from "effect"
import { tmpdir } from "../../fixture/fixture"
import type { SessionID } from "../../../src/session/schema"

const projectRoot = path.join(__dirname, "../../..")
void Log.init({ print: false })

function create(input?: SessionNs.CreateInput) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create(input)))
}

function get(id: SessionID) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.get(id)))
}

function remove(id: SessionID) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.remove(id)))
}

describe("session.created event", () => {
  test("should emit session.created event when session is created", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        let eventReceived = false
        let receivedInfo: SessionNs.Info | undefined

        const title = `created-event-${Date.now()}`
        const unsub = Bus.subscribe(SessionNs.Event.Created, (event) => {
          const info = event.properties.info as SessionNs.Info
          if (info.title !== title) return
          eventReceived = true
          receivedInfo = info
        })

        const info = await create({ title })
        await new Promise((resolve) => setTimeout(resolve, 100))
        unsub()

        expect(eventReceived).toBe(true)
        expect(receivedInfo).toBeDefined()
        expect(receivedInfo?.id).toBe(info.id)
        expect(receivedInfo?.projectID).toBe(info.projectID)
        expect(receivedInfo?.directory).toBe(info.directory)
        expect(receivedInfo?.path).toBe(info.path)
        expect(receivedInfo?.title).toBe(info.title)

        await remove(info.id)
      },
    })
  })

  test("session.created event should be emitted before session.updated", async () => {
    const previous = process.env.KILO_EXPERIMENTAL_WORKSPACES
    delete process.env.KILO_EXPERIMENTAL_WORKSPACES
    try {
      await WithInstance.provide({
        directory: projectRoot,
        fn: async () => {
          const flags = AppRuntime.runSync(Effect.service(RuntimeFlags.Service))
          const enabled = flags.experimentalWorkspaces
          Object.assign(flags, { experimentalWorkspaces: false })
          const events: string[] = []
          const title = `event-order-${Date.now()}`

          const unsubCreated = Bus.subscribe(SessionNs.Event.Created, (event) => {
            if (event.properties.info.title === title) events.push("created")
          })

          const unsubUpdated = Bus.subscribe(SessionNs.Event.Updated, (event) => {
            if (event.properties.info.title === title) events.push("updated")
          })

          const info = await create({ title })
          await new Promise((resolve) => setTimeout(resolve, 100))
          unsubCreated()
          unsubUpdated()

          expect(events).toContain("created")
          expect(events).toContain("updated")
          expect(events.indexOf("created")).toBeLessThan(events.indexOf("updated"))

          await remove(info.id)
          Object.assign(flags, { experimentalWorkspaces: enabled })
        },
      })
    } finally {
      if (previous === undefined) delete process.env.KILO_EXPERIMENTAL_WORKSPACES
      else process.env.KILO_EXPERIMENTAL_WORKSPACES = previous
    }
  })
})

describe("Session", () => {
  test("remove works without an instance", async () => {
    await using tmp = await tmpdir({ git: true })

    const info = await WithInstance.provide({
      directory: tmp.path,
      fn: () => create({ title: "remove-without-instance" }),
    })

    await expect(async () => {
      await remove(info.id)
    }).not.toThrow()

    let missing = false
    await get(info.id).catch(() => {
      missing = true
    })

    expect(missing).toBe(true)
  })
})
