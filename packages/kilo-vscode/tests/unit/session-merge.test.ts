import { describe, expect, it } from "bun:test"
import { mergeMessages, sameReconcileShape } from "../../webview-ui/src/context/session-merge"
import type { Message } from "../../webview-ui/src/types/messages"

const msg = (cost: number): Message => ({
  id: "message",
  sessionID: "session",
  role: "assistant",
  createdAt: "2026-09-23T00:00:00.000Z",
  cost,
  parts: [],
})

describe("cost reconciliation", () => {
  it("applies a cost-only update missed during a backend restart", () => {
    const current = [msg(0.1)]
    const incoming = [msg(0.3)]
    expect(sameReconcileShape(current, incoming, () => undefined)).toBe(false)
    expect(mergeMessages(current, incoming, "reconcile").at(0)?.cost).toBe(0.3)
  })

  it("skips an unchanged snapshot", () => {
    expect(sameReconcileShape([msg(0.3)], [msg(0.3)], () => undefined)).toBe(true)
  })
})
