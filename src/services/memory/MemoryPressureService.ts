import * as vscode from "vscode"

export interface MemoryStats {
	heapUsed: number
	heapTotal: number
	external: number
	rss: number
}

export interface MemoryPressureConfig {
	warningThreshold: number // MB
	criticalThreshold: number // MB
	checkInterval: number // milliseconds
	warningCooldown: number // milliseconds
}

export class MemoryPressureService {
	private static instance: MemoryPressureService | null = null
	private memoryCheckInterval: NodeJS.Timeout | null = null
	private outputChannel: vscode.OutputChannel
	private lastWarningTime = 0
	private isMonitoring = false
	private isDisposed = false

	private readonly config: MemoryPressureConfig = {
		warningThreshold: 400,
		criticalThreshold: 600,
		checkInterval: 30000,
		warningCooldown: 5 * 60 * 1000,
	}

	private constructor() {
		this.outputChannel = vscode.window.createOutputChannel("Kilo Code Memory")
		this.logMessage("Memory monitoring service initialized")
	}

	public static getInstance(): MemoryPressureService {
		if (!MemoryPressureService.instance || MemoryPressureService.instance.isDisposed) {
			MemoryPressureService.instance = new MemoryPressureService()
		}
		return MemoryPressureService.instance
	}

	public startMonitoring(): void {
		if (this.isMonitoring) {
			return
		}

		this.isMonitoring = true
		this.logMessage("Starting memory monitoring...")
		this.logCurrentMemoryStats()

		this.memoryCheckInterval = setInterval(() => {
			this.checkMemoryUsage()
		}, this.config.checkInterval)
	}

	public stopMonitoring(): void {
		if (this.memoryCheckInterval) {
			clearInterval(this.memoryCheckInterval)
			this.memoryCheckInterval = null
		}
		this.isMonitoring = false
		this.logMessage("Memory monitoring stopped")
	}

	private async checkMemoryUsage(): Promise<void> {
		const stats = this.getMemoryStats()
		const heapUsedMB = Math.round(stats.heapUsed / 1024 / 1024)

		this.logMemoryStats(stats)

		if (heapUsedMB > this.config.criticalThreshold) {
			await this.handleCriticalMemoryPressure(heapUsedMB)
		} else if (heapUsedMB > this.config.warningThreshold) {
			await this.handleMemoryWarning(heapUsedMB)
		}
	}

	private async handleMemoryWarning(heapUsedMB: number): Promise<void> {
		const now = Date.now()
		if (now - this.lastWarningTime < this.config.warningCooldown) {
			return
		}

		this.lastWarningTime = now
		this.logMessage(`⚠️  Memory warning: ${heapUsedMB}MB heap usage`, "WARN")

		const action = await vscode.window.showWarningMessage(
			`Memory usage is high (${heapUsedMB}MB). Consider closing unused files or restarting the extension.`,
			"View Memory Details",
			"Optimize Now",
			"Dismiss",
		)

		if (action === "View Memory Details") {
			this.outputChannel.show()
		} else if (action === "Optimize Now") {
			await this.triggerMemoryOptimization()
		}
	}

	private async handleCriticalMemoryPressure(heapUsedMB: number): Promise<void> {
		this.logMessage(`🚨 Critical memory pressure: ${heapUsedMB}MB heap usage`, "ERROR")

		const action = await vscode.window.showErrorMessage(
			`Critical memory usage (${heapUsedMB}MB)! The extension may become unstable.`,
			"View Memory Details",
			"Force Cleanup",
			"Restart Extension",
		)

		if (action === "View Memory Details") {
			this.outputChannel.show()
		} else if (action === "Force Cleanup") {
			await this.triggerAggressiveCleanup()
		} else if (action === "Restart Extension") {
			await vscode.commands.executeCommand("workbench.action.reloadWindow")
		}
	}

	private async triggerMemoryOptimization(): Promise<void> {
		this.logMessage("Memory optimization requested by user")
		if (global.gc) {
			global.gc()
			this.logMessage("Forced garbage collection completed")
		} else {
			this.logMessage("Garbage collection not available (run with --expose-gc flag)")
		}

		setTimeout(() => {
			this.logCurrentMemoryStats()
		}, 1000)
	}

	private async triggerAggressiveCleanup(): Promise<void> {
		this.logMessage("Aggressive memory cleanup requested by user")

		if (global.gc) {
			for (let i = 0; i < 3; i++) {
				global.gc()
				this.logMessage(`Garbage collection cycle ${i + 1} completed`)
			}
		}
		setTimeout(() => {
			this.logCurrentMemoryStats()
			this.logMessage("Aggressive cleanup completed")
		}, 2000)
	}

	private getMemoryStats(): MemoryStats {
		const memUsage = process.memoryUsage()
		return {
			heapUsed: memUsage.heapUsed,
			heapTotal: memUsage.heapTotal,
			external: memUsage.external,
			rss: memUsage.rss,
		}
	}

	private convertStatsToMB(stats: MemoryStats): {
		heapUsedMB: number
		heapTotalMB: number
		externalMB: number
		rssMB: number
	} {
		return {
			heapUsedMB: Math.round(stats.heapUsed / 1024 / 1024),
			heapTotalMB: Math.round(stats.heapTotal / 1024 / 1024),
			externalMB: Math.round(stats.external / 1024 / 1024),
			rssMB: Math.round(stats.rss / 1024 / 1024),
		}
	}

	private logMemoryStats(stats: MemoryStats): void {
		const { heapUsedMB, heapTotalMB, externalMB, rssMB } = this.convertStatsToMB(stats)

		const level =
			heapUsedMB > this.config.criticalThreshold
				? "ERROR"
				: heapUsedMB > this.config.warningThreshold
					? "WARN"
					: "INFO"

		this.logMessage(`Memory: Heap ${heapUsedMB}/${heapTotalMB}MB, External ${externalMB}MB, RSS ${rssMB}MB`, level)
	}

	private logCurrentMemoryStats(): void {
		this.logMemoryStats(this.getMemoryStats())
	}

	private logMessage(message: string, level: "INFO" | "WARN" | "ERROR" = "INFO"): void {
		const timestamp = new Date().toISOString()
		const levelPrefix = level === "INFO" ? "ℹ️" : level === "WARN" ? "⚠️" : "🚨"
		this.outputChannel.appendLine(`[${timestamp}] ${levelPrefix} ${message}`)
	}

	public getMemoryStatsFormatted(): string {
		const stats = this.getMemoryStats()
		const { heapUsedMB, heapTotalMB, externalMB, rssMB } = this.convertStatsToMB(stats)
		return `Heap: ${heapUsedMB}/${heapTotalMB}MB | External: ${externalMB}MB | RSS: ${rssMB}MB`
	}

	public showMemoryDetails(): void {
		this.logMessage("=== Memory Details ===")
		this.logCurrentMemoryStats()
		this.logMessage(`Monitoring: ${this.isMonitoring ? "Active" : "Inactive"}`)
		this.logMessage(`Warning Threshold: ${this.config.warningThreshold}MB`)
		this.logMessage(`Critical Threshold: ${this.config.criticalThreshold}MB`)
		this.logMessage(`Check Interval: ${this.config.checkInterval / 1000}s`)
		this.logMessage("======================")
		this.outputChannel.show()
	}

	public dispose(): void {
		if (this.isDisposed) {
			return
		}

		this.stopMonitoring()
		this.outputChannel.dispose()
		this.isDisposed = true
		MemoryPressureService.instance = null
	}
}
