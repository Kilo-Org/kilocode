import { describe, expect, it } from "bun:test"
import type { TuiAttentionSoundName } from "@kilocode/plugin/tui"
import { AttentionService } from "../../src/services/attention/service"
import type { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import type { SSEPayload } from "../../src/services/cli-backend/sdk-sse-adapter"
import { CustomSoundIDs, resolveSoundID } from "../../src/services/attention/sound"

function setup(opts: { approve?: () => boolean | Promise<boolean> } = {}) {
  const sounds: TuiAttentionSoundName[] = []
  const events: Array<(event: SSEPayload) => void> = []
  const states: Array<(state: "connecting" | "connected" | "disconnected" | "error") => void> = []
  const connection = {
    onEvent: (handler: (event: SSEPayload) => void) => {
      events.push(handler)
      return () => undefined
    },
    onStateChange: (handler: (state: "connecting" | "connected" | "disconnected" | "error") => void) => {
      states.push(handler)
      return () => undefined
    },
  } as unknown as KiloConnectionService
  const service = new AttentionService(connection, opts)
  ;(service as unknown as { notify: (sound: TuiAttentionSoundName) => void }).notify = (sound) => sounds.push(sound)
  return {
    sounds,
    event: (event: SSEPayload) => events[0]?.(event),
    state: (state: "connecting" | "connected" | "disconnected" | "error") => states[0]?.(state),
    service,
  }
}

function event(value: unknown) {
  return value as SSEPayload
}

describe("AttentionService", () => {
  it("plays the upstream completion sound once after a completed turn closes", () => {
    const test = setup()
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "completed" } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "completed" } }))

    expect(test.sounds).toEqual(["done"])
    test.service.dispose()
  })

  it("plays completion sounds only for parent agents", () => {
    const test = setup()
    test.event(event({ type: "session.status", properties: { sessionID: "child", status: { type: "retry" } } }))
    test.event(event({ type: "session.status", properties: { sessionID: "child", status: { type: "idle" } } }))
    test.event(
      event({
        type: "session.turn.close",
        properties: { sessionID: "child", parentID: "parent", reason: "completed" },
      }),
    )
    test.event(event({ type: "session.status", properties: { sessionID: "parent", status: { type: "busy" } } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "parent", reason: "completed" } }))

    expect(test.sounds).toEqual(["done"])
    test.service.dispose()
  })

  it("deduplicates question and permission requests", () => {
    const test = setup()
    test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }))
    test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }))
    test.event(event({ type: "question.replied", properties: { requestID: "q1", sessionID: "s1" } }))
    test.event(event({ type: "question.asked", properties: { id: "q1", sessionID: "s1" } }))
    test.event(event({ type: "permission.asked", properties: { id: "p1", sessionID: "s1" } }))
    test.event(event({ type: "permission.asked", properties: { id: "p1", sessionID: "s1" } }))

    expect(test.sounds).toEqual(["question", "question", "permission"])
    test.service.dispose()
  })

  it("stays silent for auto-approved permission requests", () => {
    const test = setup({ approve: () => true })
    test.event(event({ type: "permission.asked", properties: { id: "p1", sessionID: "s1" } }))
    test.event(event({ type: "permission.replied", properties: { requestID: "p1", sessionID: "s1" } }))

    expect(test.sounds).toEqual([])
    test.service.dispose()
  })

  it("plays attention when auto-approval fails and the request remains pending", async () => {
    const test = setup({ approve: async () => false })
    test.event(event({ type: "permission.asked", properties: { id: "p1", sessionID: "s1" } }))
    await Bun.sleep(0)

    expect(test.sounds).toEqual(["permission"])
    test.service.dispose()
  })

  it("stays silent when a permission resolves before auto-approval failure settles", async () => {
    const approval = Promise.withResolvers<boolean>()
    const test = setup({ approve: () => approval.promise })
    test.event(event({ type: "permission.asked", properties: { id: "p1", sessionID: "s1" } }))
    test.event(event({ type: "permission.replied", properties: { requestID: "p1", sessionID: "s1" } }))
    approval.resolve(false)
    await Bun.sleep(0)

    expect(test.sounds).toEqual([])
    test.service.dispose()
  })

  it("plays the error sound and suppresses the following completion", () => {
    const test = setup()
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.event(event({ type: "session.error", properties: { sessionID: "s1", error: { name: "ApiError" } } }))
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } }))

    expect(test.sounds).toEqual(["error"])
    test.service.dispose()
  })

  it("stays silent when a turn is manually interrupted after becoming idle", () => {
    const test = setup()
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "interrupted" } }))

    expect(test.sounds).toEqual([])
    test.service.dispose()
  })

  it("does not treat an aborted session error as requiring attention", () => {
    const test = setup()
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.event(
      event({
        type: "session.error",
        properties: { sessionID: "s1", error: { name: "MessageAbortedError", data: { message: "Aborted" } } },
      }),
    )
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "interrupted" } }))

    expect(test.sounds).toEqual([])
    test.service.dispose()
  })

  it("clears transitions when the backend disconnects", () => {
    const test = setup()
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.state("disconnected")
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "completed" } }))

    expect(test.sounds).toEqual([])
    test.service.dispose()
  })

  it("clears transitions when a session is deleted", () => {
    const test = setup()
    test.event(event({ type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))
    test.event(event({ type: "session.deleted", properties: { sessionID: "s1", info: { id: "s1" } } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s1", reason: "completed" } }))
    test.event(event({ type: "session.status", properties: { sessionID: "s2", status: { type: "busy" } } }))
    test.event(event({ type: "sync", name: "session.deleted.1", data: { sessionID: "s2" } }))
    test.event(event({ type: "session.turn.close", properties: { sessionID: "s2", reason: "completed" } }))

    expect(test.sounds).toEqual([])
    test.service.dispose()
  })
})

describe("attention defaults", () => {
  it("keeps attention sounds opt-in", async () => {
    const manifest = (await Bun.file(new URL("../../package.json", import.meta.url)).json()) as {
      contributes: { configuration: { properties: Record<string, { default?: unknown; enum?: unknown[] }> } }
    }
    const properties = manifest.contributes.configuration.properties

    expect(properties["kilo-code.new.attention.enabled"]?.default).toBe(false)
    expect(properties["kilo-code.new.attention.sound"]?.default).toBe("default")
    expect(properties["kilo-code.new.attention.sound"]?.enum).toEqual(["default", "system", ...CustomSoundIDs])
    expect(properties["kilo-code.new.sounds.agentEnabled"]).toBeUndefined()
    expect(properties["kilo-code.new.sounds.permissionsEnabled"]).toBeUndefined()
    expect(properties["kilo-code.new.sounds.errorsEnabled"]).toBeUndefined()
  })

  it("resolves global sound choices safely", () => {
    expect(resolveSoundID("default")).toBe("default")
    expect(resolveSoundID("system")).toBe("system")
    expect(resolveSoundID("alert-04")).toBe("alert-04")
    expect(resolveSoundID("unknown")).toBe("default")
  })

  it("packages every selectable bundled sound", async () => {
    const exists = await Promise.all(
      CustomSoundIDs.map((name) => Bun.file(new URL(`../../audio-wav/${name}.wav`, import.meta.url)).exists()),
    )
    expect(exists.every(Boolean)).toBe(true)
  })
})
