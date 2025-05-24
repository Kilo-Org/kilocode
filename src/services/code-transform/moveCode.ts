import * as fs from "fs/promises"
import * as path from "path"
import * as jscodeshift from "jscodeshift"
import { fileExistsAtPath } from "../../utils/fs"

/**
 * Interface for code movement options
 */
export interface MoveCodeOptions {
    sourceFilePath: string
    targetFilePath: string
    sourceCode: string
    startLine: number
    endLine: number
    isTypeScript: boolean
}

/**
 * Result of a code movement operation
 */
export interface MoveCodeResult {
    success: boolean
    modifiedSourceCode?: string
    modifiedTargetCode?: string
    error?: string
    movedNodes?: number // Added to track how many nodes were moved
}

/**
 * Move code from one file to another using jscodeshift
 * 
 * This function handles:
 * 1. Parsing the source code to an AST
 * 2. Identifying the nodes to move based on line numbers
 * 3. Adding appropriate exports if needed
 * 4. Removing the code from the source file
 * 5. Adding the code to the target file
 * 
 * @param options Options for the code movement
 * @returns Result of the operation
 */
export async function moveCodeWithJSCodeshift(options: MoveCodeOptions): Promise<MoveCodeResult> {
    const { targetFilePath, sourceCode, startLine, endLine, isTypeScript } = options

    try {
        // Determine the appropriate parser based on file extension
        const parser = isTypeScript ? "tsx" : "babel"

        // Parse the source code to an AST
        const sourceAst = jscodeshift.withParser(parser)(sourceCode)

        // Find nodes that fall within the specified line range
        const nodesToMove: any[] = []
        const nodesToRemove: any[] = []

        // Collect all identifiers in the source code to preserve references
        const identifierMap = new Map<string, string>();

        // First pass: collect all identifiers and their current names
        sourceAst.find(jscodeshift.Identifier).forEach((path: any) => {
            const name = path.node.name;
            // Store the current name of each identifier
            identifierMap.set(name, name);
        });

        // Helper to check if a node is within the specified line range
        // FIXED: Standardize to 0-based line numbers internally
        const isNodeInRange = (node: any) => {
            if (!node || !node.loc) return false

            // Node line numbers are 1-based in the AST, convert to 0-based for comparison
            const nodeStartLine = node.loc.start.line - 1
            const nodeEndLine = node.loc.end.line - 1

            // Convert input line numbers to 0-based for comparison
            const zeroBasedStartLine = startLine - 1
            const zeroBasedEndLine = endLine - 1

            // Check if the node is fully contained within the range
            return nodeStartLine >= zeroBasedStartLine && nodeEndLine <= zeroBasedEndLine
        }

        // Find top-level nodes that fall within the specified line range
        sourceAst.find(jscodeshift.Node).forEach((nodePath: any) => {
            const node = nodePath.node
            // Only consider top-level nodes (direct children of the program)
            if (nodePath.parent && nodePath.parent.node.type === "Program" && isNodeInRange(node)) {
                nodesToMove.push(node)
                nodesToRemove.push(nodePath)
            }
        })

        if (nodesToMove.length === 0) {
            return {
                success: false,
                error: "No valid nodes found within the specified line range",
                movedNodes: 0
            }
        }

        // Check if we need to add exports to the nodes
        const nodesToMoveWithExports = nodesToMove.map(node => {
            // Only add exports to declaration nodes that don't already have them
            if (
                (node.type === "FunctionDeclaration" ||
                    node.type === "ClassDeclaration" ||
                    node.type === "VariableDeclaration") &&
                !node.declaration?.type?.includes("Export")
            ) {
                // Create an export declaration wrapping the original node
                return jscodeshift.exportNamedDeclaration(node)
            }
            return node
        })

        // Create a new AST for the target file
        let targetCode = ""
        let targetExists = false

        try {
            // Check if target file exists
            targetExists = await fileExistsAtPath(path.resolve(targetFilePath))
            if (targetExists) {
                targetCode = await fs.readFile(targetFilePath, "utf-8")
            }
        } catch (error) {
            // File doesn't exist, we'll create it
        }

        // Parse the target code if it exists
        const targetAst = targetExists
            ? jscodeshift.withParser(parser)(targetCode)
            : jscodeshift.withParser(parser)("")

        // Add the nodes to the target AST
        nodesToMoveWithExports.forEach(node => {
            targetAst.find(jscodeshift.Program).get().node.body.push(node)
        })

        // Generate the modified target code
        const modifiedTargetCode = targetAst.toSource({ quote: "single" })

        // Remove the nodes from the source AST
        nodesToRemove.forEach(nodePath => {
            nodePath.prune()
        })

        // Generate the modified source code
        let modifiedSourceCode = sourceAst.toSource({ quote: "single" })

        // FIXED: Clean up any orphaned closing braces that might be left behind
        modifiedSourceCode = cleanupOrphanedBraces(modifiedSourceCode)

        return {
            success: true,
            modifiedSourceCode,
            modifiedTargetCode,
            movedNodes: nodesToMove.length
        }
    } catch (error) {
        return {
            success: false,
            error: `Error moving code: ${error instanceof Error ? error.message : String(error)}`,
            movedNodes: 0
        }
    }
}

/**
 * Clean up orphaned braces that might be left behind after code movement
 * 
 * @param code The source code to clean up
 * @returns Cleaned up code
 */
function cleanupOrphanedBraces(code: string): string {
    // Look for standalone closing braces that aren't matched with opening braces
    const lines = code.split('\n')
    const cleanedLines: string[] = []
    let braceBalance = 0

    for (const line of lines) {
        // Count braces in the line
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '{') braceBalance++
            if (line[i] === '}') braceBalance--
        }

        // Skip lines that only contain a closing brace and would cause negative balance
        const trimmedLine = line.trim()
        if (trimmedLine === '}' && braceBalance < 0) {
            braceBalance++  // Adjust the balance since we're skipping this brace
            continue
        }

        cleanedLines.push(line)
    }

    return cleanedLines.join('\n')
}

/**
 * Move code from one file to another
 * 
 * This is a higher-level function that handles file operations and calls moveCodeWithJSCodeshift
 * 
 * @param sourceFilePath Path to the source file
 * @param targetFilePath Path to the target file
 * @param startLine Starting line number (1-based)
 * @param endLine Ending line number (1-based)
 * @returns Result of the operation
 */
export async function moveCode(
    sourceFilePath: string,
    targetFilePath: string,
    startLine: number,
    endLine: number
): Promise<MoveCodeResult> {
    try {
        // Read the source file
        const sourceCode = await fs.readFile(sourceFilePath, "utf-8")

        // Determine if we're dealing with TypeScript
        const isTypeScript = [".ts", ".tsx"].includes(path.extname(sourceFilePath).toLowerCase()) ||
            [".ts", ".tsx"].includes(path.extname(targetFilePath).toLowerCase())

        // Move the code
        const result = await moveCodeWithJSCodeshift({
            sourceFilePath,
            targetFilePath,
            sourceCode,
            startLine,
            endLine,
            isTypeScript
        })

        if (result.success && result.modifiedSourceCode && result.modifiedTargetCode) {
            // Ensure target directory exists
            const targetDir = path.dirname(targetFilePath)
            await fs.mkdir(targetDir, { recursive: true })

            // Write the modified source code
            await fs.writeFile(sourceFilePath, result.modifiedSourceCode, "utf-8")

            // Write the modified target code
            await fs.writeFile(targetFilePath, result.modifiedTargetCode, "utf-8")
        }

        return result
    } catch (error) {
        return {
            success: false,
            error: `Error in moveCode: ${error instanceof Error ? error.message : String(error)}`,
            movedNodes: 0
        }
    }
}