import * as jscodeshift from 'jscodeshift';
import { Collection } from 'jscodeshift';

/**
 * Splice nodes from source AST and add them to target AST, then generate code
 * 
 * @param sourceAst The source file AST
 * @param targetAst The target file AST
 * @param nodesToMove Array of nodes to move from source to target
 * @param nodesToRemove Array of AST paths to remove from source
 * @returns Object containing generated source and target code
 */
export function spliceAndGenerate(
    sourceAst: Collection<any>,
    targetAst: Collection<any>,
    nodesToMove: any[],
    nodesToRemove: any[],
): { srcCode: string; tgtCode: string } {
    // Add nodes to the target AST (with exports)
    const nodesToMoveWithExports = nodesToMove.map(node => {
        // Only add exports to declaration nodes that don't already have them
        if (
            (node.type === "FunctionDeclaration" ||
                node.type === "ClassDeclaration" ||
                node.type === "VariableDeclaration") &&
            !node.declaration?.type?.includes("Export")
        ) {
            // Create an export declaration wrapping the original node
            // Don't include comments in the export declaration to avoid "export // comment" syntax
            const nodeWithoutComments = { ...node };
            if (nodeWithoutComments.comments) {
                delete nodeWithoutComments.comments;
            }
            return jscodeshift.exportNamedDeclaration(nodeWithoutComments);
        }
        return node;
    });

    // Add the nodes to the target AST
    nodesToMoveWithExports.forEach(node => {
        targetAst.find(jscodeshift.Program).get().node.body.push(node);
    });

    // Remove the nodes from the source AST
    nodesToRemove.forEach(nodePath => {
        nodePath.prune();
    });

    // Generate the modified target code
    const tgtCode = targetAst.toSource({ quote: "single" });

    // Generate the modified source code
    let srcCode = sourceAst.toSource({ quote: "single" });

    // Clean up any orphaned closing braces that might be left behind
    srcCode = cleanupOrphanedBraces(srcCode);

    return { srcCode, tgtCode };
}

/**
 * Clean up orphaned braces that might be left behind after code movement
 *
 * @param code The source code to clean up
 * @returns Cleaned up code
 */
export function cleanupOrphanedBraces(code: string): string {
    // Look for standalone closing braces that aren't matched with opening braces
    const lines = code.split('\n');
    const cleanedLines: string[] = [];
    let braceBalance = 0;

    for (const line of lines) {
        // Count braces in the line
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '{') braceBalance++;
            if (line[i] === '}') braceBalance--;
        }

        // Skip lines that only contain a closing brace and would cause negative balance
        const trimmedLine = line.trim();
        if (trimmedLine === '}' && braceBalance < 0) {
            braceBalance++;  // Adjust the balance since we're skipping this brace
            continue;
        }

        cleanedLines.push(line);
    }

    return cleanedLines.join('\n');
}