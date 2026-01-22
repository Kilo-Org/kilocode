/**
 * @kilocode/agent-runtime
 *
 * Core agent runtime for Kilo Code - enables running agents without CLI.
 * This package provides the essential components for running the Kilo Code extension
 * in a Node.js environment without VS Code.
 */

// ============================================
// Core Classes - Extension Host
// ============================================
export { ExtensionHost, createExtensionHost } from "./host/ExtensionHost.js"
export type { ExtensionHostOptions, ExtensionAPI } from "./host/ExtensionHost.js"

// ============================================
// VSCode API Mock
// ============================================
export { createVSCodeAPIMock } from "./host/VSCode.js"
export type { IdentityInfo, ExtensionContext } from "./host/VSCode.js"

// Re-export commonly used VSCode types and classes
export {
	Uri,
	Position,
	Range,
	Selection,
	Location,
	Diagnostic,
	DiagnosticSeverity,
	TextEdit,
	WorkspaceEdit,
	EventEmitter as VSCodeEventEmitter,
	ConfigurationTarget,
	ViewColumn,
	EndOfLine,
	FileType,
	FileSystemError,
} from "./host/VSCode.js"

// ============================================
// Service Layer
// ============================================
export { ExtensionService, createExtensionService } from "./services/extension.js"
export type { ExtensionServiceOptions, ExtensionServiceEvents } from "./services/extension.js"

// ============================================
// Communication / IPC
// ============================================
export { MessageBridge, IPCChannel, createMessageBridge } from "./communication/ipc.js"
export type { IPCMessage, IPCOptions } from "./communication/ipc.js"

// ============================================
// Models API (replaces `kilocode models --json`)
// ============================================
export { getAvailableModels, fetchRouterModels } from "./models/index.js"
export type { FetchRouterModelsOptions } from "./models/index.js"

// ============================================
// Types
// ============================================
export type {
	// Core message types
	ExtensionMessage,
	WebviewMessage,
	ExtensionState,
	// Provider/Model types
	ProviderSettings,
	ProviderSettingsEntry,
	ProviderName,
	RouterModels,
	ModelRecord,
	RouterName,
	ModelInfo,
	// Configuration types
	ModeConfig,
	TodoItem,
	ClineMessage,
	HistoryItem,
	// MCP types
	McpServer,
	McpTool,
	McpResource,
} from "./types/index.js"

// ============================================
// Utilities
// ============================================
export { logs, setLogger, getLogger, createIPCLogger } from "./utils/logger.js"
export type { Logger } from "./utils/logger.js"

export { KiloCodePaths } from "./utils/paths.js"
export { resolveExtensionPaths } from "./utils/extension-paths.js"
export type { ExtensionPaths } from "./utils/extension-paths.js"

export { safeStringify, argToString, argsToMessage } from "./utils/safe-stringify.js"

// ============================================
// Constants
// ============================================
export { Package } from "./constants/package.js"
