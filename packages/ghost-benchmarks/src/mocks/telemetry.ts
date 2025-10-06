/**
 * Mock implementation of @roo-code/telemetry for benchmarks
 * Provides no-op implementations to avoid dependency issues
 */

export class TelemetryService {
	static getInstance(): TelemetryService {
		return new TelemetryService()
	}

	logEvent(eventName: string, properties?: Record<string, any>): void {
		// No-op for benchmarks
		console.debug(`[Telemetry] ${eventName}`, properties)
	}

	logError(error: Error, context?: Record<string, any>): void {
		// No-op for benchmarks
		console.debug(`[Telemetry Error]`, error.message, context)
	}

	setUserId(userId: string): void {
		// No-op for benchmarks
	}

	flush(): Promise<void> {
		return Promise.resolve()
	}
}

// Export default instance
export const telemetryService = TelemetryService.getInstance()
