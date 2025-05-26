/**
 * Code Transformation DSL Entry Point
 * 
 * This module exports the public API for the Code Transformation DSL.
 * It serves as the central access point for parsing, validating, and 
 * working with DSL commands.
 */

// Export the main parser functionality
export {
    parseDslCommand,
    isSupportedOperation,
    validateOperationDetails
} from './parser';

// Export all type definitions
export * from './types';

// Export operation handlers
export { executeRenameOperation } from './operations/rename';
export { executeMoveOperation } from './operations/move';

/**
 * Create a rename command with the specified parameters
 * 
 * Helper function to create a properly structured rename command
 * 
 * @param selector The selector to identify what to rename
 * @param newName The new name to assign
 * @param acrossFiles Whether to rename across all files
 * @param schemaVersion Schema version to use
 * @returns A valid DslCommand object for a rename operation
 */
export function createRenameCommand(
    selector: import('./types').CodeSelector,
    newName: string,
    acrossFiles = true,
    schemaVersion = '1.0'
): import('./types').DslCommand & { operationDetails: import('./types').RenameOperation } {
    return {
        schemaVersion,
        operation: 'rename',
        selector,
        operationDetails: {
            type: 'rename',
            newName,
            acrossFiles
        }
    };
}

/**
 * Create a move command with the specified parameters
 * 
 * Helper function to create a properly structured move command
 * 
 * @param selector The selector to identify what to move
 * @param targetFilePath The target file to move to
 * @param targetLine Optional line position in target file (0 = append)
 * @param insertBefore Whether to insert before specified line
 * @param addExports Whether to add exports in source file
 * @param addImports Whether to add imports in target file
 * @param schemaVersion Schema version to use
 * @returns A valid DslCommand object for a move operation
 */
export function createMoveCommand(
    selector: import('./types').CodeSelector,
    targetFilePath: string,
    targetLine?: number,
    insertBefore = false,
    addExports = true,
    addImports = true,
    schemaVersion = '1.0'
): import('./types').DslCommand & { operationDetails: import('./types').MoveOperation } {
    const operationDetails: import('./types').MoveOperation = {
        type: 'move',
        targetFilePath,
        addExports,
        addImports
    };

    if (targetLine !== undefined) {
        operationDetails.targetPosition = {
            line: targetLine,
            insertBefore
        };
    }

    return {
        schemaVersion,
        operation: 'move',
        selector,
        operationDetails
    };
}