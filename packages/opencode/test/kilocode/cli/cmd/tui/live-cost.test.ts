import { describe, expect, test } from "bun:test"
import type { Part } from "@kilocode/sdk/v2"
import { KiloTuiLiveCost } from "@/kilocode/cli/cmd/tui/live-cost"

type Event = Parameters<typeof KiloTuiLiveCost.delta>[0]

const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

function finish(input: { id: string; messageID: string; cost: number }): Part {
  return {
    id: input.id,
    sessionID: "ses_1",
    messageID: input.messageID,
    type: "step-finish",
    reason: "stop",
    cost: input.cost,
    tokens,
  }
}

function start(input: { id: string; messageID: string }): Part {
  return {
    id: input.id,
    sessionID: "ses_1",
    messageID: input.messageID,
    type: "step-start",
  }
}

function event(name: Event["name"], data: Event["data"]): Event {
  return {
    type: "sync",
    name,
    id: "evt_1",
    seq: 1,
    aggregateID: "sessionID",
    data,
  } as Event
}

describe("TUI live cost delta", () => {
  test("adds cost for new step-finish parts", () => {
    const part = finish({ id: "part_1", messageID: "msg_1", cost: 1.25 })

    expect(
      KiloTuiLiveCost.delta(event("message.part.updated.1", { sessionID: "ses_1", part, time: 0 }), { parts: {} }),
    ).toEqual({ sessionID: "ses_1", cost: 1.25 })
  })

  test("applies only the changed cost for existing step-finish parts", () => {
    const before = finish({ id: "part_1", messageID: "msg_1", cost: 1 })
    const after = finish({ id: "part_1", messageID: "msg_1", cost: 3 })

    expect(
      KiloTuiLiveCost.delta(event("message.part.updated.1", { sessionID: "ses_1", part: after, time: 0 }), {
        parts: { msg_1: [before] },
      }),
    ).toEqual({ sessionID: "ses_1", cost: 2 })
  })

  test("subtracts cost when step-finish parts are removed", () => {
    expect(
      KiloTuiLiveCost.delta(
        event("message.part.removed.1", { sessionID: "ses_1", messageID: "msg_1", partID: "part_1" }),
        { parts: { msg_1: [finish({ id: "part_1", messageID: "msg_1", cost: 1.5 })] } },
      ),
    ).toEqual({ sessionID: "ses_1", cost: -1.5 })
  })

  test("subtracts step-finish costs when whole messages are removed", () => {
    expect(
      KiloTuiLiveCost.delta(event("message.removed.1", { sessionID: "ses_1", messageID: "msg_1" }), {
        parts: {
          msg_1: [
            start({ id: "part_1", messageID: "msg_1" }),
            finish({ id: "part_2", messageID: "msg_1", cost: 2 }),
            finish({ id: "part_3", messageID: "msg_1", cost: 3 }),
          ],
        },
      }),
    ).toEqual({ sessionID: "ses_1", cost: -5 })
  })

  test("ignores non-cost sync events and missing parts", () => {
    expect(
      KiloTuiLiveCost.delta(event("message.part.removed.1", { sessionID: "ses_1", messageID: "msg_1", partID: "none" }), {
        parts: { msg_1: [start({ id: "part_1", messageID: "msg_1" })] },
      }),
    ).toBeUndefined()
  })
})
