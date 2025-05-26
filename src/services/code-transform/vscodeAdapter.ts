import * as path from 'path';
import * as fs from 'fs/promises';
import { moveCodeByIdentifier } from './index';
import { MoveCodeResult } from './validation/moveCodeSchema';
import {
    CompleteCommand,
    MoveOperation,
    RenameOperation,
    RemoveOperation,
    MoveResult,
    RenameResult,
    RemoveResult
} from './dsl/types';
import { executeMoveOperation } from './dsl/operations/move';
import { executeRenameOperation } from './dsl/operations/rename';
import { executeRemoveOperation } from './dsl/operations/remove';

/**
 * VSCode Refactoring Adapter
 * 
 * This class bridges between VS Code API and our refactoring services.
 * It handles editor-specific concerns like selections and document management.
 */
export class VSCodeRefactoringAdapter {
    private workspaceRoot: string;

    /**
     * Create a new VS Code refactoring adapter
     * 
     * @param workspaceRoot The root directory of the workspace
     */
    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Move code from one file to another by identifier name
     * 
     * @param sourceFilePath Source file path (relative to workspace root)
     * @param targetFilePath Target file path (relative to workspace root)
     * @param identifierName Name of the identifier to move
     * @param kind Optional kind of identifier
     * @returns Result of the operation
     */
    async moveCodeByIdentifier(
        sourceFilePath: string,
        targetFilePath: string,
        identifierName: string,
        kind?: 'function' | 'variable' | 'class' | 'method' | 'property' | 'parameter' | 'import' | 'other'
    ): Promise<MoveCodeResult> {
        // Resolve paths relative to workspace root
        const absoluteSourcePath = path.isAbsolute(sourceFilePath)
            ? sourceFilePath
            : path.join(this.workspaceRoot, sourceFilePath);

        const absoluteTargetPath = path.isAbsolute(targetFilePath)
            ? targetFilePath
            : path.join(this.workspaceRoot, targetFilePath);

        // Ensure source file exists
        try {
            await fs.access(absoluteSourcePath);
        } catch (error) {
            return {
                success: false,
                error: `Source file not found: ${sourceFilePath}`
            };
        }

        // Perform the move operation
        return moveCodeByIdentifier(
            absoluteSourcePath,
            absoluteTargetPath,
            identifierName,
            kind
        );
    }

    /**
     * Get the absolute path from a path relative to the workspace root
     * 
     * @param relativePath Path relative to workspace root
     * @returns Absolute path
     */
    getAbsolutePath(relativePath: string): string {
        if (path.isAbsolute(relativePath)) {
            return relativePath;
        }
        return path.join(this.workspaceRoot, relativePath);
    }

    /**
     * Execute a DSL command for code refactoring
     * 
     * This method handles both move and rename operations by delegating to the
     * appropriate implementation based on the operation type.
     * 
     * @param command The DSL command to execute
     * @returns Result of the operation (MoveResult or RenameResult)
     */
    async executeDslCommand(command: CompleteCommand<MoveOperation | RenameOperation | RemoveOperation>): Promise<MoveResult | RenameResult | RemoveResult> {
        try {
            // Resolve paths relative to workspace root
            if (command.operation === 'move') {
                const moveOp = command.operationDetails as MoveOperation;

                // Resolve paths
                const absoluteTargetPath = this.getAbsolutePath(moveOp.targetFilePath);

                // Get the selector
                const selector = command.selector;

                // If it's an identifier selector with a file path, resolve it
                if (selector.type === 'identifier' && selector.filePath) {
                    selector.filePath = this.getAbsolutePath(selector.filePath);
                }

                // Execute the move operation
                return executeMoveOperation({
                    ...moveOp,
                    targetFilePath: absoluteTargetPath
                }, selector);
            }
            else if (command.operation === 'rename') {
                const renameOp = command.operationDetails as RenameOperation;

                // Resolve file path if present
                if (command.selector.type === 'identifier' && command.selector.filePath) {
                    command.selector.filePath = this.getAbsolutePath(command.selector.filePath);
                }

                // Execute the rename operation
                return executeRenameOperation(renameOp, command.selector);
            }
            else if (command.operation === 'remove') {
                const removeOp = command.operationDetails as RemoveOperation;

                // Resolve file path if present
                if (command.selector.type === 'identifier' && command.selector.filePath) {
                    command.selector.filePath = this.getAbsolutePath(command.selector.filePath);
                }

                // Execute the remove operation
                return executeRemoveOperation(removeOp, command.selector);
            }
            else {
                return {
                    success: false,
                    error: `Unsupported operation type: ${command.operation}`
                } as MoveResult | RenameResult | RemoveResult;
            }
        } catch (error) {
            return {
                success: false,
                error: `Error executing DSL command: ${error instanceof Error ? error.message : String(error)}`
            } as MoveResult | RenameResult | RemoveResult;
        }
    }
}