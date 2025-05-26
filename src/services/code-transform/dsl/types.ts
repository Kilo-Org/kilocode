/**
 * Type definitions for the Code Transformation DSL
 *
 * This module defines the core interfaces and types for the code transformation
 * domain-specific language (DSL). The DSL provides a structured way to define
 * code refactoring operations like renaming and moving code elements.
 *
 * IMPORTANT: All operations are now batch-based. Even single operations must be
 * provided as an array.
 */

/**
 * Base interface for a single refactoring operation
 *
 * Each operation specifies what to do and which code element to target.
 */
export interface RefactorOperation {
	/** Type of operation to perform (e.g., "rename", "move") */
	operation: string

	/** Selector that identifies the target code element */
	selector: CodeSelector

	/** Operation-specific fields are added via intersection types */
	[key: string]: any
}

/**
 * Move operation with required fields
 */
export interface MoveRefactorOperation extends RefactorOperation {
	operation: "move"
	targetFilePath: string
}

/**
 * Rename operation with required fields
 */
export interface RenameRefactorOperation extends RefactorOperation {
	operation: "rename"
	newName: string
}

/**
 * Remove operation with required fields
 */
export interface RemoveRefactorOperation extends RefactorOperation {
	operation: "remove"
}

/**
 * Union type for all refactor operations
 */
export type AnyRefactorOperation = MoveRefactorOperation | RenameRefactorOperation | RemoveRefactorOperation

/**
 * Batch command containing multiple operations
 *
 * This is the main structure for all refactoring requests.
 * All operations must be provided as an array.
 */
export interface BatchDslCommand {
	/** Array of operations to perform */
	operations: AnyRefactorOperation[]

	/** Version of the DSL schema (for future compatibility) */
	schemaVersion?: string
}

/**
 * Legacy single command interface (deprecated)
 *
 * @deprecated Use BatchDslCommand instead. This interface is kept for
 * internal compatibility but will be removed in future versions.
 */
export interface DslCommand {
	/** Version of the DSL schema (for future compatibility) */
	schemaVersion: string

	/** Type of operation to perform (e.g., "rename", "move") */
	operation: string

	/** Selector that identifies the target code element(s) */
	selector: CodeSelector

	/** Custom options specific to each operation type */
	options?: Record<string, unknown>
}

/**
 * Union type for all possible code selectors
 */
export type CodeSelector = LocationSelector | IdentifierSelector | AstSelector

/**
 * Selector that identifies code elements by file location
 *
 * This selector targets code based on file path and line numbers,
 * which is useful for selecting specific regions of code by position.
 */
export interface LocationSelector {
	/** Type discriminator */
	type: "location"

	/** Path to the file containing the target code */
	filePath: string

	/** Starting line number (1-indexed) */
	startLine: number

	/** Ending line number (1-indexed, inclusive) */
	endLine: number

	/** Optional starting column number (1-indexed) */
	startColumn?: number

	/** Optional ending column number (1-indexed, inclusive) */
	endColumn?: number
}

/**
 * Selector that identifies code elements by their identifier name
 *
 * This selector targets code symbols like variables, functions, or classes
 * by their name, optionally scoped to a specific file.
 */
export interface IdentifierSelector {
	/** Type discriminator */
	type: "identifier"

	/** Name of the identifier to select */
	name: string

	/** Optional path to limit search to a specific file */
	filePath?: string

	/** Whether to match all occurrences across files (defaults to false) */
	global?: boolean

	/** Kind of identifier (function, class, variable, etc.) */
	kind?: string
}

/**
 * Selector that identifies code elements by AST structure
 *
 * This selector uses abstract syntax tree (AST) queries to precisely
 * target code elements based on their syntax structure.
 */
export interface AstSelector {
	/** Type discriminator */
	type: "ast"

	/** Path to the file containing the target code */
	filePath: string

	/** AST node type to match (e.g., "FunctionDeclaration") */
	nodeType: string

	/** Additional constraints to narrow the selection */
	constraints?: {
		/** Match specific properties of the node */
		properties?: Record<string, unknown>

		/** Match by the node's textual content */
		content?: string

		/** Match by the node's position in the source */
		position?: {
			startLine: number
			endLine: number
			startColumn?: number
			endColumn?: number
		}
	}
}

/**
 * Base interface for all operation types
 */
export interface Operation {
	/** Type of operation */
	type: string
}

/**
 * Rename operation to change a symbol's name
 *
 * This operation renames an identifier throughout its scope,
 * updating all references to maintain correctness.
 */
export interface RenameOperation extends Operation {
	/** Type discriminator */
	type: "rename"

	/** New name to give the selected element */
	newName: string

	/** Whether to rename across all files or just the selected file (defaults to true) */
	acrossFiles?: boolean
}

/**
 * Move operation to relocate code to a different file
 *
 * This operation moves code elements from one file to another,
 * handling dependencies, imports, and exports automatically.
 */
export interface MoveOperation extends Operation {
	/** Type discriminator */
	type: "move"

	/** Target file path where code should be moved to */
	targetFilePath: string

	/** Position in the target file where code should be inserted */
	targetPosition?: {
		/** Line number to insert at (0 means append to end of file) */
		line: number

		/** Whether to insert before the specified line (true) or after (false) */
		insertBefore?: boolean
	}

	/** Whether to add necessary exports in source file (defaults to true) */
	addExports?: boolean

	/** Whether to add necessary imports in target file (defaults to true) */
	addImports?: boolean
}

/**
 * Remove operation to delete code elements
 *
 * This operation removes code elements from a file,
 * handling any necessary cleanup of references.
 */
export interface RemoveOperation extends Operation {
	/** Type discriminator */
	type: "remove"
}

/**
 * Union type for all supported operations
 */
export type OperationType = RenameOperation | MoveOperation | RemoveOperation

/**
 * Complete DSL command interface combining a selector with an operation
 */
export interface CompleteCommand<T extends OperationType> extends DslCommand {
	/** The operation to perform */
	operationDetails: T
}

/**
 * Base interface for operation execution results
 */
export interface DslResult {
	/** Whether the operation was successful */
	success: boolean

	/** Error message in case of failure */
	error?: string

	/** Optional metadata about the operation */
	metadata?: Record<string, unknown>
}

/**
 * Result of a rename operation
 */
export interface RenameResult extends DslResult {
	/** List of files that were modified */
	modifiedFiles?: string[]

	/** Modified content by file path */
	modifiedContent?: Record<string, string>

	/** Number of references that were updated */
	referencesUpdated?: number
}

/**
 * Result of a move operation
 */
export interface MoveResult extends DslResult {
	/** Path to the source file that was modified */
	sourceFilePath?: string

	/** Path to the target file that was modified */
	targetFilePath?: string

	/** Modified source file content */
	modifiedSourceContent?: string

	/** Modified target file content */
	modifiedTargetContent?: string

	/** Number of code elements that were moved */
	elementsMoved?: number

	/** List of exports added to source file */
	exportsAdded?: string[]

	/** List of imports added to target file */
	importsAdded?: string[]
}

/**
 * Result of a remove operation
 */
export interface RemoveResult extends DslResult {
	/** Path to the file that was modified */
	filePath?: string

	/** Modified file content */
	modifiedContent?: string

	/** Number of code elements that were removed */
	elementsRemoved?: number

	/** List of imports that were removed */
	importsRemoved?: string[]

	/** List of files that were modified */
	modifiedFiles?: string[]
}

/**
 * Type guard to check if a selector is a LocationSelector
 */
export function isLocationSelector(selector: CodeSelector): selector is LocationSelector {
	return selector.type === "location"
}

/**
 * Type guard to check if a selector is an IdentifierSelector
 */
export function isIdentifierSelector(selector: CodeSelector): selector is IdentifierSelector {
	return selector.type === "identifier"
}

/**
 * Type guard to check if a selector is an AstSelector
 */
export function isAstSelector(selector: CodeSelector): selector is AstSelector {
	return selector.type === "ast"
}

/**
 * Type guard to check if an operation is a RenameOperation
 */
export function isRenameOperation(operation: OperationType): operation is RenameOperation {
	return operation.type === "rename"
}

/**
 * Type guard to check if an operation is a MoveOperation
 */
export function isMoveOperation(operation: OperationType): operation is MoveOperation {
	return operation.type === "move"
}

/**
 * Type guard to check if an operation is a RemoveOperation
 */
export function isRemoveOperation(operation: OperationType): operation is RemoveOperation {
	return operation.type === "remove"
}
