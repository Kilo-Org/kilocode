import { describe, expect, it } from "bun:test"
import type { TelemetryRequest } from "../../webview-ui/src/types/messages/webview-messages"
import { capture, tracker } from "../../webview-ui/agent-manager/telemetry"
import { TelemetryEventName } from "../../src/services/telemetry/types"

describe("Agent Manager telemetry", () => {
  it("uses one stable event with low-cardinality button metadata", () => {
    const messages: TelemetryRequest[] = []

    capture({ postMessage: (message) => messages.push(message) }, "fullscreen_review", "tab_toolbar", {
      action: "open",
      fileCount: 3,
    })

    expect(messages).toEqual([
      {
        type: "telemetry",
        event: TelemetryEventName.AGENT_MANAGER_BUTTON_CLICKED,
        properties: {
          action: "open",
          fileCount: 3,
          source: "agent-manager",
          button: "fullscreen_review",
          surface: "tab_toolbar",
        },
      },
    ])
  })

  it("does not allow callers to override event dimensions", () => {
    const messages: TelemetryRequest[] = []

    capture({ postMessage: (message) => messages.push(message) }, "apply_to_local", "apply_dialog", {
      source: "other",
      button: "other",
      surface: "other",
    })

    expect(messages[0]?.properties).toMatchObject({
      source: "agent-manager",
      button: "apply_to_local",
      surface: "apply_dialog",
    })
  })

  it("resolves current properties before running wrapped actions", () => {
    const messages: TelemetryRequest[] = []
    const order: string[] = []
    const metrics = tracker({
      postMessage: (message) => {
        messages.push(message)
        order.push("telemetry")
      },
    })
    const state = { action: "run" }
    const click = metrics.click(
      "run_script",
      "tab_toolbar",
      () => order.push("action"),
      () => state,
    )
    state.action = "stop"

    click()

    expect(messages[0]?.properties?.action).toBe("stop")
    expect(order).toEqual(["telemetry", "action"])
  })
})
