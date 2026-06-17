import { TelemetryEventName } from "../../src/services/telemetry/types"
import type { TelemetryRequest } from "../src/types/messages/webview-messages"

interface Target {
  postMessage(message: TelemetryRequest): void
}

type Value = string | number | boolean | undefined
type Properties = Record<string, Value>
type Input = Properties | (() => Properties)

export function capture(target: Target, button: string, surface: string, properties: Properties = {}) {
  target.postMessage({
    type: "telemetry",
    event: TelemetryEventName.AGENT_MANAGER_BUTTON_CLICKED,
    properties: {
      ...properties,
      source: "agent-manager",
      button,
      surface,
    },
  })
}

function clicked(target: Target, button: string, surface: string, action: () => void, properties: Input = {}) {
  return () => {
    capture(target, button, surface, typeof properties === "function" ? properties() : properties)
    action()
  }
}

function used<T>(target: Target, button: string, surface: string, action: (value: T) => void) {
  return (value: T) => {
    capture(target, button, surface)
    action(value)
  }
}

export function tracker(target: Target) {
  return {
    track: (button: string, surface: string, properties?: Properties) => capture(target, button, surface, properties),
    click: (button: string, surface: string, action: () => void, properties?: Input) =>
      clicked(target, button, surface, action, properties),
    use: <T>(button: string, surface: string, action: (value: T) => void) => used(target, button, surface, action),
  }
}
