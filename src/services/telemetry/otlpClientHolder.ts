// kilocode_change - OTLP telemetry client holder
import type { OtlpTelemetryClient } from "@roo-code/telemetry"

let _client: OtlpTelemetryClient | null = null

export function setOtlpClient(client: OtlpTelemetryClient): void {
	_client = client
}

export function getOtlpClient(): OtlpTelemetryClient | null {
	return _client
}
