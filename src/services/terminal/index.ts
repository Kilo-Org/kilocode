// AntiGravity Terminal Services - Intelligent Terminal & Tool Integration for Kilo Code
// Provides proactive context-aware terminal capabilities for AI agents

export { PTYManager } from "./PTYManager"
export { TerminalBuffer } from "./TerminalBuffer"
export { AIActionTools } from "./AIActionTools"
export { AutonomousDebuggingLoop } from "./AutonomousDebuggingLoop"
export { OdooIntegrationPatterns } from "./OdooIntegrationPatterns"
export { SecurityPermissionGate } from "./SecurityPermissionGate"
export { AntiGravityTerminalService } from "./AntiGravityTerminalService"
export { TerminalErrorHighlighter } from "./TerminalErrorHighlighter"

// Re-export types for convenience
export type { PTYManagerOptions, TerminalBufferEntry, PatternMatch, CommandExecution } from "./PTYManager"

export type { SearchOptions, SearchResult, BufferStats } from "./TerminalBuffer"

export type {
	ShellCommandOptions,
	ShellCommandResult,
	ListenPattern,
	PatternMatchEvent,
	CommandApprovalRequest,
} from "./AIActionTools"

export type { ErrorPattern, ParsedError, FixSuggestion, DebuggingSession, FixAttempt } from "./AutonomousDebuggingLoop"

export type { OdooCommandPreset, OdooCommandParameter, OdooLogPattern, OdooModelError } from "./OdooIntegrationPatterns"

export type { SecurityRule, PermissionRequest, PermissionResponse, SecurityPolicy } from "./SecurityPermissionGate"

export type { AntiGravityTerminalConfig, TerminalSession } from "./AntiGravityTerminalService"

export type { ErrorHighlight, FixAction } from "./TerminalErrorHighlighter"
