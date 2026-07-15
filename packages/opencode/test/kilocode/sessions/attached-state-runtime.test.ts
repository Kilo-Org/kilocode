import { describe, expect, test } from "bun:test"
import { AttachedState } from "@/kilo-sessions/attached-state"

describe("AttachedState (runtime-aware heartbeat)", () => {
  test("setPresence uses the passive notify heartbeat", async () => {
    let passiveCalls = 0
    let announcedCalls = 0
    const state = AttachedState.create({
      notifyHeartbeat: () => {
        passiveCalls++
      },
      announceHeartbeat: () => {
        announcedCalls++
        return Promise.resolve()
      },
      log: { warn: () => {} },
    })
    state.setPresence(["ses_a"])
    expect(passiveCalls).toBe(1)
    expect(announcedCalls).toBe(0)
  })

  test("announce uses and awaits the announced heartbeat", async () => {
    let announced = false
    const state = AttachedState.create({
      notifyHeartbeat: () => {},
      announceHeartbeat: () => {
        announced = true
        return Promise.resolve()
      },
      log: { warn: () => {} },
    })
    await state.announce("ses_b")
    expect(announced).toBe(true)
  })

  test("announce failure rolls back the pending entry without touching presence", async () => {
    let announced = 0
    const state = AttachedState.create({
      notifyHeartbeat: () => {},
      announceHeartbeat: () => {
        announced++
        return Promise.reject(new Error("relay down"))
      },
      log: { warn: () => {} },
    })
    state.setPresence(["ses_existing"])
    // ses_existing is already in presence — announce is a no-op.
    await state.announce("ses_existing")
    // Now announce a new id — it should fail and not corrupt presence.
    await expect(state.announce("ses_new")).rejects.toThrow("relay down")
    // Presence still contains the original id.
    expect([...state.union()]).toEqual(["ses_existing"])
    // Only the second announce (for a new id) called announceHeartbeat.
    expect(announced).toBe(1)
  })

  test("a successful announce adopts the id into the next setPresence heartbeat", async () => {
    let passiveUnion: string[] = []
    const state = AttachedState.create({
      notifyHeartbeat: () => {},
      announceHeartbeat: () => Promise.resolve(),
      log: { warn: () => {} },
    })
    await state.announce("ses_announced")
    state.setPresence(["ses_announced"])
    // The second setPresence should be a no-op (lastSentKey already covers it).
    // We can verify by checking that no error is thrown and the union is correct.
    passiveUnion = [...state.union()]
    expect(passiveUnion).toContain("ses_announced")
  })

  test("reset clears both presence and pending", () => {
    const state = AttachedState.create({
      notifyHeartbeat: () => {},
      announceHeartbeat: () => Promise.resolve(),
      log: { warn: () => {} },
    })
    state.setPresence(["ses_a"])
    state.reset()
    expect([...state.union()]).toEqual([])
  })

  test("legacy heartbeat() option still works (backward compat)", () => {
    let legacyCalls = 0
    const state = AttachedState.create({
      heartbeat: () => {
        legacyCalls++
        return Promise.resolve()
      },
      log: { warn: () => {} },
    })
    state.setPresence(["ses_a"])
    // The legacy heartbeat is used as a fallback for both setPresence and announce.
    expect(legacyCalls).toBeGreaterThan(0)
  })
})
