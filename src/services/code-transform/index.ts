/**
 * Code Transformation Service
 *
 * This module provides a unified API for code transformation operations like
 * moving code between files, renaming symbols, and other refactoring operations.
 *
 * USAGE:
 * - Use moveCodeByIdentifier for moving code between files - it's precise and robust
 * - This implementation uses AST analysis to find the exact code to move
 */

import path from "path"
import { MoveCodeResult } from "./validation/moveCodeSchema"

// Re-export types that consumers might need
export type { MoveCodeResult } from "./validation/moveCodeSchema"

/**
 * Move code from one file to another by identifier name.
 *
 * This uses AST analysis to find the exact code to move, preserving structure and dependencies.
 *
 * @param srcPath Source file path
 * @param targetPath Target file path
 * @param identifierName Name of the identifier to move (function, class, etc.)
 * @param kind Optional kind of identifier (function, class, etc.)
 * @returns Result of the operation
 */
export async function moveCodeByIdentifier(
	srcPath: string,
	targetPath: string,
	identifierName: string,
	kind?: "function" | "variable" | "class" | "method" | "property" | "parameter" | "import" | "other",
): Promise<MoveCodeResult> {
	// Import dynamically to avoid circular dependencies
	const { moveSymbol } = await import("./moveSymbol")
	return moveSymbol(srcPath, targetPath, identifierName, kind)
}

/**
 * Get relative import path between two files
 */
export function getRelativeImportPath(fromFilePath: string, toFilePath: string): string {
	const relativePath = path.relative(path.dirname(fromFilePath), toFilePath)
	const withoutExtension = relativePath.replace(/\.(ts|tsx|js|jsx)$/, "")

	// Ensure it starts with ./ or ../
	if (!withoutExtension.startsWith(".")) {
		return "./" + withoutExtension
	}

	return withoutExtension.replace(/\\/g, "/") // Normalize path separators
}
