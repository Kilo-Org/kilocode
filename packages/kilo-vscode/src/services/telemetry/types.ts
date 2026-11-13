import { KiloTelemetryRpc } from "@opencode/schema/kilocode/telemetry"

/** The extension's event names. The one list is the `kilocode.telemetry` contract's catalog. */
export const TelemetryEventName = KiloTelemetryRpc.EventName
export type TelemetryEventName = KiloTelemetryRpc.EventName

/** Provider that supplies context properties to be merged into every telemetry event. */
export interface TelemetryPropertiesProvider {
  getTelemetryProperties(): Record<string, unknown>
}
