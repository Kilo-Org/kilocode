import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Session as SessionNs } from "@/session/session"
import { KiloSessionPrompt } from "@/kilocode/session/prompt"
import type { MessageV2 } from "@/session/message-v2"
import { Bus } from "../../../src/bus"
import * as Log from "@opencode-ai/core/util/log"
import { Instance } from "../../../src/project/instance"
import { AppRuntime } from "../../../src/effect/app-runtime"
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
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let eventReceived = false
        let receivedInfo: SessionNs.Info | undefined

        const unsub = Bus.subscribe(SessionNs.Event.Created, (event) => {
          eventReceived = true
          receivedInfo = event.properties.info as SessionNs.Info
        })

        const info = await create({})
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
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const events: string[] = []

        const unsubCreated = Bus.subscribe(SessionNs.Event.Created, () => {
          events.push("created")
        })

        const unsubUpdated = Bus.subscribe(SessionNs.Event.Updated, () => {
          events.push("updated")
        })

        const info = await create({})
        await new Promise((resolve) => setTimeout(resolve, 100))
        unsubCreated()
        unsubUpdated()

        expect(events).toContain("created")
        expect(events).toContain("updated")
        expect(events.indexOf("created")).toBeLessThan(events.indexOf("updated"))

        await remove(info.id)
      },
    })
  })
})

describe("Session", () => {
  test("plan filename uses a safe slug from the session title", async () => {
    await using tmp = await tmpdir({ git: true })

    const plan = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        SessionNs.plan(
          {
            slug: "quiet-otter",
            title: "Fix OAuth callback: Windows/WSL path?",
            time: { created: 1234567890 },
          },
          Instance.current,
        ),
    })

    expect(plan).toBe(path.join(tmp.path, ".kilo", "plans", "1234567890-fix-oauth-callback-windows-wsl-path.md"))
  })

  test("plan filename falls back to session slug for default titles", async () => {
    await using tmp = await tmpdir({ git: true })

    const plan = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        SessionNs.plan(
          {
            slug: "quiet-otter",
            title: "New session - 2026-05-19T12:34:56.789Z",
            time: { created: 1234567890 },
          },
          Instance.current,
        ),
    })

    expect(plan).toBe(path.join(tmp.path, ".kilo", "plans", "1234567890-quiet-otter.md"))
  })

  test("plan path uses the current user prompt while the session title is still default", async () => {
    await using tmp = await tmpdir({ git: true })

    const plan = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        KiloSessionPrompt.planPath({
          session: {
            slug: "quiet-otter",
            title: "New session - 2026-05-19T12:34:56.789Z",
            time: { created: 1234567890 },
          } as SessionNs.Info,
          userMessage: {
            parts: [{ type: "text", text: "Create a release checklist for Windows installs" }],
          } as MessageV2.WithParts,
          instance: Instance.current,
        }),
    })

    expect(plan).toBe(
      path.join(tmp.path, ".kilo", "plans", "1234567890-create-a-release-checklist-for-windows-installs.md"),
    )
  })

  test("plan filename reuses an existing file for the session timestamp", async () => {
    await using tmp = await tmpdir({ git: true })
    const dir = path.join(tmp.path, ".kilo", "plans")
    const existing = path.join(dir, "1234567890-create-login-flow.md")
    await fs.mkdir(dir, { recursive: true })
    await Bun.write(existing, "Existing plan")

    const plan = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        SessionNs.plan(
          {
            slug: "quiet-otter",
            title: "Generated conversation title",
            time: { created: 1234567890 },
          },
          Instance.current,
        ),
    })

    expect(plan).toBe(existing)
  })

  test("remove works without an instance", async () => {
    await using tmp = await tmpdir({ git: true })

    const info = await Instance.provide({
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
