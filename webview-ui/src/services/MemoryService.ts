// kilocode_change - new file
import { telemetryClient } from "../utils/TelemetryClient"
import { TelemetryEventName } from "@roo-code/types"

interface PerformanceMemory {
	usedJSHeapSize?: number
	totalJSHeapSize?: number
}

export class MemoryService {
	private intervalId: number | null = null
	private readonly intervalMs: number = 60 * 1000 // 1 min

	public start(): void {
		if (this.intervalId) {
			return
		}
		this.reportMemoryUsage()

		this.intervalId = window.setInterval(() => {
			this.reportMemoryUsage()
		}, this.intervalMs)
	}

	public stop(): void {
		if (this.intervalId) {
			window.clearInterval(this.intervalId)
			this.intervalId = null
		}
	}

	private reportMemoryUsage(): void {
		const memory = (performance as Performance & { memory?: PerformanceMemory }).memory
		const memoryInfo = {
			heapUsedMb: this.bytesToMegabytes(memory?.usedJSHeapSize || 0),
			heapTotalMb: this.bytesToMegabytes(memory?.totalJSHeapSize || 0),
		}
		telemetryClient.capture(TelemetryEventName.WEBVIEW_MEMORY_USAGE, memoryInfo)
	}

	private bytesToMegabytes(bytes: number): number {
		return Math.round((bytes / 1024 / 1024) * 100) / 100
	}
}
