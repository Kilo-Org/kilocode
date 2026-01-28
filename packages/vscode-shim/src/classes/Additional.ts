/**
 * Additional VSCode API classes for extension support
 *
 * This file contains supplementary classes and types that extensions may need.
 */

import { Range } from "./Range.js"
import type { IUri, IRange, IPosition, DiagnosticSeverity, DiagnosticTag } from "../types.js"

/**
 * Represents a location in source code (URI + Range or Position)
 */
export class Location {
	constructor(
		public uri: IUri,
		public range: IRange | IPosition,
	) {}
}

/**
 * Related diagnostic information
 */
export class DiagnosticRelatedInformation {
	constructor(
		public location: Location,
		public message: string,
	) {}
}

/**
 * Represents a diagnostic (error, warning, etc.)
 */
export class Diagnostic {
	range: Range
	message: string
	severity: DiagnosticSeverity
	source?: string
	code?: string | number | { value: string | number; target: IUri }
	relatedInformation?: DiagnosticRelatedInformation[]
	tags?: DiagnosticTag[]

	constructor(range: IRange, message: string, severity?: DiagnosticSeverity) {
		this.range = range as Range
		this.message = message
		this.severity = severity !== undefined ? severity : 0 // Error
	}
}

/**
 * Theme color reference
 */
export class ThemeColor {
	constructor(public id: string) {}
}

/**
 * Theme icon reference
 */
export class ThemeIcon {
	constructor(
		public id: string,
		public color?: ThemeColor,
	) {}
}

/**
 * Code action kind for categorizing code actions
 */
export class CodeActionKind {
	static readonly Empty = new CodeActionKind("")
	static readonly QuickFix = new CodeActionKind("quickfix")
	static readonly Refactor = new CodeActionKind("refactor")
	static readonly RefactorExtract = new CodeActionKind("refactor.extract")
	static readonly RefactorInline = new CodeActionKind("refactor.inline")
	static readonly RefactorRewrite = new CodeActionKind("refactor.rewrite")
	static readonly Source = new CodeActionKind("source")
	static readonly SourceOrganizeImports = new CodeActionKind("source.organizeImports")

	constructor(public value: string) {}

	append(parts: string): CodeActionKind {
		return new CodeActionKind(this.value ? `${this.value}.${parts}` : parts)
	}

	intersects(other: CodeActionKind): boolean {
		return this.contains(other) || other.contains(this)
	}

	contains(other: CodeActionKind): boolean {
		return this.value === other.value || other.value.startsWith(this.value + ".")
	}
}

/**
 * Code lens for displaying inline information
 */
export class CodeLens {
	public range: Range
	public command?: { command: string; title: string; arguments?: unknown[] } | undefined
	public isResolved: boolean = false

	constructor(range: IRange, command?: { command: string; title: string; arguments?: unknown[] } | undefined) {
		this.range = range as Range
		this.command = command
	}
}

/**
 * Language Model API parts
 */
export class LanguageModelTextPart {
	constructor(public value: string) {}
}

export class LanguageModelToolCallPart {
	constructor(
		public callId: string,
		public name: string,
		public input: unknown,
	) {}
}

export class LanguageModelToolResultPart {
	constructor(
		public callId: string,
		public content: unknown[],
	) {}
}

/**
 * File system error with specific error codes
 */
export class FileSystemError extends Error {
	public code: string

	constructor(message: string, code: string = "Unknown") {
		super(message)
		this.name = "FileSystemError"
		this.code = code
	}

	static FileNotFound(messageOrUri?: string | IUri): FileSystemError {
		const message =
			typeof messageOrUri === "string" ? messageOrUri : `File not found: ${messageOrUri?.fsPath || "unknown"}`
		return new FileSystemError(message, "FileNotFound")
	}

	static FileExists(messageOrUri?: string | IUri): FileSystemError {
		const message =
			typeof messageOrUri === "string" ? messageOrUri : `File exists: ${messageOrUri?.fsPath || "unknown"}`
		return new FileSystemError(message, "FileExists")
	}

	static FileNotADirectory(messageOrUri?: string | IUri): FileSystemError {
		const message =
			typeof messageOrUri === "string"
				? messageOrUri
				: `File is not a directory: ${messageOrUri?.fsPath || "unknown"}`
		return new FileSystemError(message, "FileNotADirectory")
	}

	static FileIsADirectory(messageOrUri?: string | IUri): FileSystemError {
		const message =
			typeof messageOrUri === "string"
				? messageOrUri
				: `File is a directory: ${messageOrUri?.fsPath || "unknown"}`
		return new FileSystemError(message, "FileIsADirectory")
	}

	static NoPermissions(messageOrUri?: string | IUri): FileSystemError {
		const message =
			typeof messageOrUri === "string" ? messageOrUri : `No permissions: ${messageOrUri?.fsPath || "unknown"}`
		return new FileSystemError(message, "NoPermissions")
	}

	static Unavailable(messageOrUri?: string | IUri): FileSystemError {
		const message =
			typeof messageOrUri === "string" ? messageOrUri : `Unavailable: ${messageOrUri?.fsPath || "unknown"}`
		return new FileSystemError(message, "Unavailable")
	}
}
