/**
 * Telemetry interface for the agent runtime.
 * This allows the runtime to be used with any telemetry implementation.
 */
export interface TelemetryService {
	trackExtensionMessageSent(messageType: string): void
	trackExtensionMessageReceived(messageType: string): void
}

/**
 * No-op telemetry implementation.
 * Used when no custom telemetry service is provided.
 */
class NoOpTelemetryService implements TelemetryService {
	trackExtensionMessageSent(_messageType: string): void {
		// No-op
	}

	trackExtensionMessageReceived(_messageType: string): void {
		// No-op
	}
}

// Global telemetry service instance - can be overridden by setTelemetryService
let globalTelemetryService: TelemetryService = new NoOpTelemetryService()

/**
 * Set the global telemetry service instance.
 * Call this early in your application to use a custom telemetry service.
 */
export function setTelemetryService(service: TelemetryService): void {
	globalTelemetryService = service
}

/**
 * Get the current global telemetry service instance.
 */
export function getTelemetryService(): TelemetryService {
	return globalTelemetryService
}
