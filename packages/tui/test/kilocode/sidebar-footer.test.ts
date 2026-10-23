import { expect, test } from "bun:test"
import type { SessionMessageAssistant } from "@opencode/client"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"

import { billable, creditLabel, format, passLine, resetLabel, scope } from "../../src/kilocode/plugins/sidebar-footer"

const kiloPass = {
  currentPeriodBaseCreditsUsd: 199,
  currentPeriodUsageUsd: 73.27,
  currentPeriodBonusCreditsUsd: 99.5,
  nextBillingAt: "2026-07-01T00:00:00.000Z",
} satisfies NonNullable<KiloGatewayRpc.KiloPass>

const message = {
  id: "msg_1",
  time: { created: 1, completed: 2 },
  type: "assistant",
  agent: "build",
  model: { id: "kilo-auto/balanced", providerID: "kilo" },
  content: [],
  cost: 0.1,
} satisfies SessionMessageAssistant

test("formats money", () => {
  expect(format(12.345)).toBe("$12.35")
  expect(format(0)).toBe("$0.00")
})

test("labels balance scope", () => {
  expect(scope(null)).toEqual({ kind: "Personal" })
  expect(scope("org_1", [{ id: "org_1", name: "Acme" }])).toEqual({ kind: "Team", name: "Acme" })
  expect(creditLabel(scope(null))).toBe("Personal credits")
  expect(creditLabel(scope("org_1", [{ id: "org_1", name: "Acme" }]))).toBe("Acme team")
})

test("shows pass period usage and reset date", () => {
  expect(passLine(kiloPass)).toBe("$73 / $199")
  expect(resetLabel(kiloPass.nextBillingAt)).toBe("Jul 1")
  expect(resetLabel(null)).toBeUndefined()
  expect(resetLabel("not-a-date")).toBeUndefined()
})

test("refreshes only after completed billed Kilo turns", () => {
  expect(billable(message)).toBeTrue()
  expect(billable({ ...message, model: { ...message.model, providerID: "anthropic" } })).toBeFalse()
  expect(billable({ ...message, cost: 0 })).toBeFalse()
  expect(billable({ ...message, time: { created: 1 } })).toBeFalse()
})
