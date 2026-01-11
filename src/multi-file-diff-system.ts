/**
 * Multi-File Diff System - Main Export Index
 *
 * Central exports for the Multi-File Diff and Auto-Navigation System
 */

// Core Services - Import for internal use
import { FileOpenerService as FileOpenerServiceClass } from "./services/file-management/file-opener"
import { TabManagerService as TabManagerServiceClass } from "./services/file-management/tab-manager"
import { SessionStateManager as SessionStateManagerClass } from "./services/session/session-state"
import { MemoryManagementService as MemoryManagementServiceClass } from "./services/performance/memory-management"
import { BackgroundProcessingService as BackgroundProcessingServiceClass } from "./services/performance/background-processing"
import { PerformanceMonitoringService as PerformanceMonitoringServiceClass } from "./services/performance/performance-monitoring"

// Core Services - Re-export
export { FileOpenerService } from "./services/file-management/file-opener"
export { TabManagerService } from "./services/file-management/tab-manager"
export { FileTypeDetectionService } from "./services/file-management/file-type-detection"

// Diff Services
export { DiffOverlayManager } from "./services/diff/diff-overlay"
export { StreamingDiffProcessor } from "./services/diff/streaming-diff"

// Session Management
export { SessionStateManager } from "./services/session/session-state"
export { MultiFileStateCoordinator } from "./services/session/multi-file-coordinator"

// Performance Services
export { MemoryManagementService } from "./services/performance/memory-management"
export { BackgroundProcessingService } from "./services/performance/background-processing"
export { PerformanceMonitoringService } from "./services/performance/performance-monitoring"

// Integration
export { VSCodeIntegration } from "./services/integration/editor-hooks"

// Type Definitions
export type {
	FileBuffer,
	ShadowBuffer,
	DiffOverlay,
	DiffResult,
	DiffLine,
	StreamingDiffOptions,
	CreateDiffRequest,
	CreateDiffResponse,
	DiffActionResponse,
	OpenFileRequest,
	OpenFileResponse,
	ValidationRule,
	PerformanceMetrics,
	DiffEvent,
	FileChangeEvent,
} from "./types/diff-types"

export type {
	SessionState,
	FileState,
	SessionSettings,
	SessionActionResponse,
	SessionEvent,
	FileSessionEvent,
} from "./types/session-types"

// Re-export commonly used utilities
export { Logger } from "./services/error-handler"
export { DiffEventManager } from "./services/event-system"

/**
 * System initialization helper
 */
export async function initializeMultiFileDiffSystem(context: any): Promise<void> {
	try {
		// Initialize core services
		const fileOpener = new FileOpenerServiceClass()
		const tabManager = new TabManagerServiceClass()
		const sessionManager = SessionStateManagerClass.getInstance(context)
		const memoryManager = MemoryManagementServiceClass.getInstance()
		const backgroundProcessor = BackgroundProcessingServiceClass.getInstance()
		const performanceMonitor = PerformanceMonitoringServiceClass.getInstance()

		// Initialize all services
		await Promise.all([
			fileOpener.initialize(),
			tabManager.initialize(),
			sessionManager.initialize(),
			memoryManager.initialize(),
			backgroundProcessor.initialize(),
			performanceMonitor.initialize(),
		])

		console.log("Multi-File Diff System initialized successfully")
	} catch (error) {
		console.error("Failed to initialize Multi-File Diff System:", error)
		throw error
	}
}

/**
 * System version and metadata
 */
export const SYSTEM_INFO = {
	name: "Multi-File Diff and Auto-Navigation System",
	version: "1.0.0",
	description: "AI-driven multi-file diff visualization and management",
	author: "Kilo Code",
	features: [
		"inline-diff-overlays",
		"multi-file-management",
		"streaming-processing",
		"performance-monitoring",
		"session-persistence",
		"file-type-detection",
	],
}
