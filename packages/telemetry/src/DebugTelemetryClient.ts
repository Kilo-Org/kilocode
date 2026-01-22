// kilocode_change - new file
import { type TelemetryEvent } from "@roo-code/types"

import { BaseTelemetryClient } from "./BaseTelemetryClient"

/**
 * DebugTelemetryClient logs all telemetry events to the console.
 * Use this for local development to see what telemetry data would be sent.
 */
export class DebugTelemetryClient extends BaseTelemetryClient {
	constructor() {
		super(undefined, true)
		// Always enable telemetry for debug client
		this.telemetryEnabled = true
	}

	public override async capture(event: TelemetryEvent): Promise<void> {
		const properties = await this.getEventProperties(event)

		// Log event name and properties as expandable object in debug console
		console.info(`[DebugTelemetry] ${event.event}`, properties)
	}

	public override updateTelemetryState(_didUserOptIn: boolean): void {
		// Always keep telemetry enabled for debug client
		this.telemetryEnabled = true
	}

	public override async shutdown(): Promise<void> {
		console.info("[DebugTelemetry] Shutdown")
	}

	public override async captureException(error: Error, properties?: Record<string | number, unknown>): Promise<void> {
		let providerProperties = {}
		try {
			providerProperties = (await this.providerRef?.deref()?.getTelemetryProperties()) || {}
		} catch (e) {
			console.error("[DebugTelemetry] Error getting provider properties", e)
		}
		console.error(`[DebugTelemetry] Exception: ${error.message}`, {
			stack: error.stack,
			...providerProperties,
			...properties,
		})
	}
}
