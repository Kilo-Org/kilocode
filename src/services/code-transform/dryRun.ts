/**
 * Dry run functionality for code refactoring operations
 *
 * This module provides functionality to preview code refactoring operations
 * without actually modifying files. It analyzes operations and generates
 * readable previews of what would happen if the operations were executed.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { DslCommand, OperationType, MoveOperation, RenameOperation } from './dsl/types';
import { CodeRefactoringError, createError } from './errors';

/**
 * Result of a dry run preview operation
 */
export interface DryRunResult {
    /** Summary of what would happen */
    summary: string;

    /** More detailed preview of changes */
    details: {
        /** Files that would be modified */
        filesToModify: string[];

        /** Preview of changes by file */
        changes: Record<string, ChangePreview>;

        /** Any warnings about potential issues */
        warnings: string[];
    };

    /** Original operation details */
    operation: DslCommand & { operationDetails: OperationType };
}

/**
 * Preview of changes to a single file
 */
interface ChangePreview {
    /** Type of change (add, modify, delete) */
    changeType: 'add' | 'modify' | 'delete';

    /** Preview snippets showing before/after */
    snippets?: {
        before?: string;
        after?: string;
        lineRange?: [number, number]; // 1-indexed, inclusive
    }[];

    /** Description of the change */
    description: string;
}

/**
 * Create a preview of what would happen if the refactoring operation were executed
 *
 * @param workspaceRoot Root directory of the workspace
 * @param command DSL command with operation details
 * @returns Promise resolving to a dry run result
 */
export async function createDryRunPreview(
    workspaceRoot: string,
    command: DslCommand & { operationDetails: OperationType }
): Promise<DryRunResult> {
    try {
        const { operation, selector, operationDetails } = command;

        if (operation === 'move') {
            return await createMovePreview(workspaceRoot, command, selector, operationDetails as MoveOperation);
        } else if (operation === 'rename') {
            return await createRenamePreview(workspaceRoot, command, selector, operationDetails as RenameOperation);
        } else {
            throw createError('unsupported_operation', `Unsupported operation type: ${operation}`);
        }
    } catch (error) {
        if (error instanceof CodeRefactoringError) {
            throw error;
        }
        throw createError('dry_run_error', `Failed to create preview: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Create a preview for a move operation
 *
 * @param workspaceRoot Root directory of the workspace
 * @param command The original DSL command
 * @param selector Code selector identifying what to move
 * @param operation Move operation details
 * @returns Promise resolving to a dry run result
 */
async function createMovePreview(
    workspaceRoot: string,
    command: DslCommand & { operationDetails: OperationType },
    selector: DslCommand['selector'],
    operation: MoveOperation
): Promise<DryRunResult> {
    // Get source file path from selector
    let sourceFilePath: string;
    let startLine = 1;
    let endLine = 1;

    if (selector.type === 'location') {
        sourceFilePath = selector.filePath;
        startLine = selector.startLine;
        endLine = selector.endLine;
    } else if (selector.type === 'identifier') {
        if (!selector.filePath) {
            throw createError('invalid_selector', 'File path is required in selector for move operations');
        }
        sourceFilePath = selector.filePath;
        // For identifier selectors, we'd need to find the actual line range
        // This is a simplification - in a real implementation we'd determine this from AST
        startLine = 0;
        endLine = 0;
    } else if (selector.type === 'ast') {
        sourceFilePath = selector.filePath;

        if (selector.constraints?.position) {
            startLine = selector.constraints.position.startLine;
            endLine = selector.constraints.position.endLine;
        } else {
            // For AST selectors without position, we'd need a more complex analysis
            // This is a simplification
            startLine = 0;
            endLine = 0;
        }
    } else {
        throw createError('invalid_selector', 'Invalid selector type for move operation');
    }

    // Target file
    const targetFilePath = operation.targetFilePath;

    // Read source file content
    let sourceContent: string;
    try {
        sourceContent = await fs.readFile(path.resolve(workspaceRoot, sourceFilePath), 'utf8');
    } catch (error) {
        throw createError(
            'file_read_error',
            `Failed to read source file: ${sourceFilePath}`
        );
    }

    // Read target file content if it exists
    let targetContent: string;
    try {
        targetContent = await fs.readFile(path.resolve(workspaceRoot, targetFilePath), 'utf8')
            .catch(() => '// New file will be created');
    } catch (error) {
        targetContent = '// New file will be created';
    }

    // Extract the lines that would be moved (if we have line information)
    const codeToMove = startLine && endLine ?
        extractLines(sourceContent, startLine, endLine) :
        `// Code from ${sourceFilePath} would be extracted based on the selector`;

    // Create before/after snippets
    const sourceSnippet = {
        before: trimToPreviewSize(sourceContent, 10),
        after: startLine && endLine ?
            trimToPreviewSize(removeLines(sourceContent, startLine, endLine), 10) :
            '// Modified source with code removed and exports added',
        lineRange: [Math.max(1, startLine - 3), Math.min(startLine + 3, sourceContent.split('\n').length)] as [number, number]
    };

    const targetSnippet = {
        before: trimToPreviewSize(targetContent, 10),
        after: `${targetContent.trim()}\n\n${codeToMove}`,
        lineRange: targetContent.split('\n').length > 0 ?
            [Math.max(1, targetContent.split('\n').length - 3), targetContent.split('\n').length] as [number, number] :
            [1, 1] as [number, number]
    };

    // Determine what dependencies might be added
    const warnings: string[] = [];
    if (codeToMove.includes('import')) {
        warnings.push('The moved code contains import statements which may need adjustment');
    }

    // Generate a summary description
    let description = '';
    if (selector.type === 'identifier') {
        description = `Move ${selector.kind || 'symbol'} '${selector.name}' from ${sourceFilePath} to ${targetFilePath}`;
    } else if (selector.type === 'ast') {
        description = `Move ${selector.nodeType} from ${sourceFilePath} to ${targetFilePath}`;
    } else {
        description = `Move lines ${startLine}-${endLine} from ${sourceFilePath} to ${targetFilePath}`;
    }

    return {
        summary: `${description}. This will modify 2 files.`,
        details: {
            filesToModify: [sourceFilePath, targetFilePath],
            changes: {
                [sourceFilePath]: {
                    changeType: 'modify',
                    snippets: [sourceSnippet],
                    description: 'Code will be moved out and exports may be added'
                },
                [targetFilePath]: {
                    changeType: targetContent === '// New file will be created' ? 'add' : 'modify',
                    snippets: [targetSnippet],
                    description: 'Code will be inserted and imports may be added'
                }
            },
            warnings
        },
        operation: command
    };
}

/**
 * Create a preview for a rename operation
 *
 * @param workspaceRoot Root directory of the workspace
 * @param command The original DSL command
 * @param selector Code selector identifying what to rename
 * @param operation Rename operation details
 * @returns Promise resolving to a dry run result
 */
async function createRenamePreview(
    workspaceRoot: string,
    command: DslCommand & { operationDetails: OperationType },
    selector: DslCommand['selector'],
    operation: RenameOperation
): Promise<DryRunResult> {
    // Get source file path from selector
    let sourceFilePath: string;
    let symbolName: string;

    if (selector.type === 'location') {
        sourceFilePath = selector.filePath;
        symbolName = '[Symbol at line ' + selector.startLine + ']';
    } else if (selector.type === 'identifier') {
        if (!selector.filePath) {
            throw createError('invalid_selector', 'File path is required in selector for rename operations');
        }
        sourceFilePath = selector.filePath;
        symbolName = selector.name;
    } else if (selector.type === 'ast') {
        sourceFilePath = selector.filePath;

        if (selector.nodeType === 'StringLiteral' && selector.constraints?.content) {
            symbolName = `'${selector.constraints.content}'`;
        } else {
            symbolName = `[${selector.nodeType}]`;
        }
    } else {
        throw createError('invalid_selector', 'Invalid selector type for rename operation');
    }

    // Read source file content
    let sourceContent: string;
    try {
        sourceContent = await fs.readFile(path.resolve(workspaceRoot, sourceFilePath), 'utf8');
    } catch (error) {
        throw createError(
            'file_read_error',
            `Failed to read source file: ${sourceFilePath}`
        );
    }

    // Create a simple preview by replacing occurrences in the content
    // Note: This is simplified and doesn't account for many edge cases a real rename would handle
    const newName = operation.newName;

    // In a real implementation, we'd use AST analysis to find references correctly
    // This is just a simplified preview
    const modifiedContent = sourceContent.split(symbolName).join(newName);

    const sourceSnippet = {
        before: trimToPreviewSize(sourceContent, 10),
        after: trimToPreviewSize(modifiedContent, 10),
        lineRange: [1, Math.min(10, sourceContent.split('\n').length)] as [number, number]
    };

    // Determine if other files might be affected
    const warnings: string[] = [];
    if (operation.acrossFiles) {
        warnings.push(`This rename will also update references in other files that import '${symbolName}'`);
    }

    // Generate a summary description
    const description = `Rename ${selector.type === 'identifier' ? (selector.kind || 'symbol') : 'symbol'} '${symbolName}' to '${newName}'`;

    return {
        summary: `${description}${operation.acrossFiles ? ' across all files' : ''}.`,
        details: {
            filesToModify: operation.acrossFiles ?
                [`${sourceFilePath} and potentially other files with references`] :
                [sourceFilePath],
            changes: {
                [sourceFilePath]: {
                    changeType: 'modify',
                    snippets: [sourceSnippet],
                    description: `Occurrences of '${symbolName}' will be renamed to '${newName}'`
                }
            },
            warnings
        },
        operation: command
    };
}

// Helper functions

/**
 * Extract a range of lines from a string
 *
 * @param content Source content
 * @param startLine Starting line number (1-indexed)
 * @param endLine Ending line number (1-indexed, inclusive)
 * @returns Lines extracted from the content
 */
function extractLines(content: string, startLine: number, endLine: number): string {
    const lines = content.split('\n');
    return lines.slice(startLine - 1, endLine).join('\n');
}

/**
 * Remove a range of lines from a string
 *
 * @param content Source content
 * @param startLine Starting line number (1-indexed)
 * @param endLine Ending line number (1-indexed, inclusive)
 * @returns Content with lines removed
 */
function removeLines(content: string, startLine: number, endLine: number): string {
    const lines = content.split('\n');
    return [
        ...lines.slice(0, startLine - 1),
        ...lines.slice(endLine)
    ].join('\n');
}

/**
 * Trim a string to a maximum number of lines for preview
 *
 * @param content Content to trim
 * @param maxLines Maximum number of lines to include
 * @returns Trimmed content
 */
function trimToPreviewSize(content: string, maxLines: number): string {
    const lines = content.split('\n');
    if (lines.length <= maxLines) {
        return content;
    }

    return lines.slice(0, maxLines).join('\n') + '\n// ... more lines ...';
}