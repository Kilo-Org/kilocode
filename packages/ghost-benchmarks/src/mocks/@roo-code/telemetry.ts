// Mock telemetry service for Ghost benchmarks
// Provides no-op implementations to avoid dependencies

export class TelemetryService {
	static getInstance(): TelemetryService {
		return new TelemetryService()
	}

	logEvent(eventName: string, properties?: Record<string, any>): void {
		// No-op for benchmarks
	}

	logError(error: Error, properties?: Record<string, any>): void {
		// No-op for benchmarks
	}

	logPerformance(name: string, duration: number, properties?: Record<string, any>): void {
		// No-op for benchmarks
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
