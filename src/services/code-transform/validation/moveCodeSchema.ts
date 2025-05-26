import { z } from 'zod';

/**
 * Schema for validating move code options
 */
export const MoveCodeOptionsSchema = z.object({
    sourceFilePath: z.string().min(1, "Source file path is required"),
    targetFilePath: z.string().min(1, "Target file path is required"),
    sourceCode: z.string().optional(),
    startLine: z.number().int().positive("Start line must be positive"),
    endLine: z.number().int().positive("End line must be positive"),
    isTypeScript: z.boolean().optional().default(false),
    batchOperation: z.boolean().optional(),
}).refine(data => data.endLine >= data.startLine, {
    message: "End line must be greater than or equal to start line",
    path: ["endLine"], // Path of the property which will receive the error
});

/**
 * Result of a code movement operation
 */
export interface MoveCodeResult {
    success: boolean;
    modifiedSourceCode?: string;
    modifiedTargetCode?: string;
    error?: string;
    movedNodes?: number; // Number of nodes moved
    importsAdded?: boolean; // Flag to indicate if imports were added
    exportedNames?: string[]; // Names of exported symbols for import generation
    dependenciesImported?: boolean; // Flag to indicate if dependencies were imported
    dependencies?: string[]; // Names of dependencies that were imported
    typeReferencesHandled?: boolean; // Flag to indicate if type references were handled
    nestedFunctionsHandled?: boolean; // Flag to indicate if nested functions were extracted and handled
    filesWritten?: boolean; // Flag to indicate if files were successfully written
}

/**
 * Standard error result helper
 */
export function errorResult(error: string): MoveCodeResult {
    return {
        success: false,
        error,
        movedNodes: 0
    };
}

/**
 * Standard empty nodes result helper
 */
export function noNodesResult(): MoveCodeResult {
    return {
        success: false,
        error: "No valid nodes found within the specified line range",
        movedNodes: 0
    };
}

/**
 * Standard success result helper
 */
export function successResult(
    modifiedSourceCode: string,
    modifiedTargetCode: string,
    movedNodes: number,
    exportedNames: string[] = [],
    dependencies: string[] = [],
    typeReferencesHandled: boolean = false,
    nestedFunctionsHandled: boolean = false
): MoveCodeResult {
    return {
        success: true,
        modifiedSourceCode,
        modifiedTargetCode,
        movedNodes,
        importsAdded: exportedNames.length > 0,
        exportedNames,
        dependenciesImported: dependencies.length > 0,
        dependencies,
        typeReferencesHandled,
        nestedFunctionsHandled
    };
}