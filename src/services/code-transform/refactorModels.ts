/**
 * Models for code refactoring operations
 */

// Base interface for all refactor operations
export interface RefactorOperation {
	operation: string
}

// Move to file operation
export interface MoveToFileOperation extends RefactorOperation {
	operation: "move_to_file"
	sourceFilePath: string
	targetFilePath: string
	// Either use line numbers OR identifier name
	startLine?: number
	endLine?: number
	// For identifier-based movement
	identifierName?: string
}

// Rename symbol operation
export interface RenameSymbolOperation extends RefactorOperation {
	operation: "rename_symbol"
	filePath: string
	newName: string
	// One of these must be provided
	startLine?: number
	oldName?: string
	// Whether to rename across all files in the workspace
	acrossFiles?: boolean
}

// Legacy format interfaces (for backward compatibility)
export interface LegacyMoveToFileOperation extends RefactorOperation {
	operation: "move_to_file"
	start_line: string | number
	end_line: string | number
	target_path: string
}

export interface LegacyRenameSymbolOperation extends RefactorOperation {
	operation: "rename_symbol"
	new_name: string
	start_line?: string | number
	old_name?: string
}

// Results

// Base result interface
export interface RefactorResult {
	success: boolean
	error?: string
}

// Result of a move operation
export interface MoveToFileResult extends RefactorResult {
	modifiedSourceCode?: string
	modifiedTargetCode?: string
	movedNodes?: number
	importsAdded?: boolean
	exportedNames?: string[]
}

// Result of a rename operation
export interface RenameSymbolResult extends RefactorResult {
	modifiedFiles?: string[]
	modifiedCode?: Record<string, string>
	affectedReferences?: number
}
