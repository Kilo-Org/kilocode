import { describe, expect, test } from "bun:test"
import { Interrupt } from "../../src/kilocode/interrupt"

const INITIAL: Interrupt.State = { pending: false, escapeCount: 0, firstEscapeAt: null, target: null }
const CHILD_PENDING: Interrupt.State = { pending: true, escapeCount: 0, firstEscapeAt: null, target: "child" }
const NORMAL: Interrupt.State = { pending: false, escapeCount: 0, firstEscapeAt: null, target: "normal" }
const WINDOW = 5000

describe("kilocode interrupt state controller", () => {
  test("idle child status does not confirm success while parent task is still running", () => {
    const s = { ...CHILD_PENDING }
    const r = Interrupt.onStatus(s, "busy", "idle", true, true)
    expect(r.state).toEqual(s)
    expect(r.actions).toHaveLength(0)
  })

  test("foreground task transition running to not running confirms child success", () => {
    const s = { ...CHILD_PENDING }
    const r = Interrupt.onForegroundTask(s, true, false)
    expect(r.state.pending).toBe(false)
    expect(r.state.target).toBe(null)
    expect(r.actions).toHaveLength(1)
    expect(r.actions[0].type).toBe("success")
  })

  test("child removal without a foreground task clears pending", () => {
    const s = { ...CHILD_PENDING }
    const r = Interrupt.onChildRemoved(s, false)
    expect(r.state.pending).toBe(false)
    expect(r.state.target).toBe(null)
    expect(r.actions).toHaveLength(1)
    expect(r.actions[0].type).toBe("clearPending")
  })

  test("child removal with a foreground task preserves pending state", () => {
    const s = { ...CHILD_PENDING }
    const r = Interrupt.onChildRemoved(s, true)
    expect(r.state).toEqual(s)
    expect(r.actions).toHaveLength(0)
  })

  test("child abort rejection while pending emits exactly one error and clears pending", () => {
    const s = { ...CHILD_PENDING }
    const r = Interrupt.onAbortReject(s, "boom")
    expect(r.state.pending).toBe(false)
    expect(r.state.target).toBe(null)
    expect(r.actions).toHaveLength(1)
    expect(r.actions[0].type).toBe("error")
    expect((r.actions[0] as { message: string }).message).toBe("boom")
  })

  test("normal-session abort rejection emits exactly one error", () => {
    const s = { ...NORMAL }
    const r = Interrupt.onAbortReject(s, "network failure")
    expect(r.state.target).toBe(null)
    expect(r.actions).toHaveLength(1)
    expect(r.actions[0].type).toBe("error")
    expect((r.actions[0] as { message: string }).message).toBe("network failure")
  })

  test("normal target survives child cleanup and can still emit error on reject", () => {
    const s = { ...NORMAL }
    const r1 = Interrupt.onChildRemoved(s, false)
    expect(r1.state.target).toBe("normal")
    const r2 = Interrupt.onAbortReject(r1.state, "reject after cleanup")
    expect(r2.actions).toHaveLength(1)
    expect(r2.actions[0].type).toBe("error")
  })

  test("first Escape at 0 and second after >5000ms yields zero abort actions", () => {
    const a = Interrupt.onEscape(INITIAL, 0, { windowMs: WINDOW })
    const b = Interrupt.onEscape(a.state, 5001, { windowMs: WINDOW })
    expect(b.actions).toHaveLength(0)
    expect(b.state.escapeCount).toBe(1)
    expect(b.state.target).toBe(null)
  })

  test("two Escapes within 5000ms yields exactly one abort and resets Escape state", () => {
    const a = Interrupt.onEscape(INITIAL, 0, { windowMs: WINDOW })
    const b = Interrupt.onEscape(a.state, 1000, { windowMs: WINDOW })
    expect(b.actions).toHaveLength(1)
    expect(b.actions[0].type).toBe("abort")
    expect(b.state.escapeCount).toBe(0)
    expect(b.state.firstEscapeAt).toBe(null)
    expect(b.state.target).toBe(null)
  })
})
