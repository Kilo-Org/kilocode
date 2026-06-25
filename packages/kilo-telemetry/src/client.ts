import { TelemetryEvent } from "./events.js"

export namespace Client {
  export function init() {}

  export function getClient(): null {
    return null
  }

  export function setEnabled(_value: boolean) {}

  export function isEnabled(): boolean {
    return false
  }

  export function capture(_event: TelemetryEvent, _properties?: Record<string, unknown>) {}

  export function identify(_distinctId: string, _properties?: Record<string, unknown>) {}

  export function alias(_distinctId: string, _aliasId: string) {}

  export async function shutdown(_timeoutMs?: number): Promise<void> {}
}
