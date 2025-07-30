import * as vscode from "vscode"
import { TelemetryService } from "@roo-code/telemetry"
import type { MemoryMetrics } from "@roo-code/types"

/**
 * Service that periodically monitors and reports memory usage metrics via telemetry
 */
export class MemoryService {
	private intervalId: NodeJS.Timeout | null = null
	private readonly intervalMs: number = 60 * 1000 // 1 minute

	constructor(private readonly context: vscode.ExtensionContext) {}

	public start(): void {
		if (this.intervalId) {
			return
		}
		this.reportMemoryUsage()

		// Set up periodic reporting
		this.intervalId = setInterval(() => {
			this.reportMemoryUsage()
		}, this.intervalMs)

		// Register cleanup on extension deactivation
		this.context.subscriptions.push({
			dispose: () => this.stop(),
		})
	}

	public stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId)
			this.intervalId = null
		}
	}

	private reportMemoryUsage(): void {
		try {
			const memoryUsage = process.memoryUsage()

			const metrics: MemoryMetrics = {
				heapUsed: this.bytesToMegabytes(memoryUsage.heapUsed),
				heapTotal: this.bytesToMegabytes(memoryUsage.heapTotal),
				external: this.bytesToMegabytes(memoryUsage.external),
				rss: this.bytesToMegabytes(memoryUsage.rss),
			}

			if (TelemetryService.hasInstance()) {
				TelemetryService.instance.captureMemoryUsage(metrics)
			}
		} catch (error) {
			console.error(
				`[MemoryService] Error reporting memory usage: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	private bytesToMegabytes(bytes: number): number {
		return Math.round((bytes / 1024 / 1024) * 100) / 100
	}
}
