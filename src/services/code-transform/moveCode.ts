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
    importsAdded?: boolean // Flag to indicate if imports were added
    exportedNames?: string[] // Names of exported symbols for import generation
    dependenciesImported?: boolean // Flag to indicate if dependencies were imported
    dependencies?: string[] // Names of dependencies that were imported
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
 * 6. Identifying and adding imports for dependencies
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

        // Track dependencies of moved code
        const dependencies = new Set<string>()

        // Helper to check if a node is within the specified line range
        // Standardize to 0-based line numbers internally
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

        // Extract names of exported symbols for import generation
        const exportedNames: string[] = [];

        // First pass: collect all identifiers defined in the nodes to move
        const definedSymbols = new Set<string>();

        nodesToMove.forEach(node => {
            // Extract names based on node type
            if (node.type === "FunctionDeclaration" && node.id && node.id.name) {
                exportedNames.push(node.id.name);
                definedSymbols.add(node.id.name);
            } else if (node.type === "ClassDeclaration" && node.id && node.id.name) {
                exportedNames.push(node.id.name);
                definedSymbols.add(node.id.name);
            } else if (node.type === "VariableDeclaration" && node.declarations) {
                node.declarations.forEach((decl: any) => {
                    if (decl.id && decl.id.type === "Identifier") {
                        exportedNames.push(decl.id.name);
                        definedSymbols.add(decl.id.name);
                    }
                });
            }
        });

        // Second pass: find dependencies by traversing the AST of the nodes to move
        const builtInsAndKeywords = new Set([
            "console", "document", "window", "process", "require",
            "Array", "Object", "String", "Number", "Boolean", "Date",
            "Math", "JSON", "Promise", "Map", "Set", "RegExp",
            "if", "else", "for", "while", "do", "switch", "case", "break",
            "continue", "return", "function", "class", "const", "let", "var",
            "this", "super", "new", "try", "catch", "finally", "throw",
            "typeof", "instanceof", "in", "of", "void", "null", "undefined",
            "true", "false", "export", "import", "default", "extends", "implements"
        ]);

        // Track local variables and parameters to avoid false dependencies
        const localVariables = new Set<string>();

        // Improved traverse function with better scope handling
        function traverse(node: any, scope: Set<string> = new Set()) {
            if (!node) return;

            // Handle function declarations and their parameters
            if (node.type === 'FunctionDeclaration' || node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
                // Create a new scope for this function
                const functionScope = new Set(scope);

                // Add function name to the parent scope if it exists
                if (node.id && node.id.name) {
                    localVariables.add(node.id.name);
                }

                // Add parameters to the function scope
                if (node.params) {
                    node.params.forEach((param: any) => {
                        if (param.type === 'Identifier') {
                            functionScope.add(param.name);
                            localVariables.add(param.name);
                        } else if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') {
                            functionScope.add(param.left.name);
                            localVariables.add(param.left.name);
                        } else if (param.type === 'ObjectPattern') {
                            // Handle destructuring in parameters
                            param.properties.forEach((prop: any) => {
                                if (prop.value && prop.value.type === 'Identifier') {
                                    functionScope.add(prop.value.name);
                                    localVariables.add(prop.value.name);
                                }
                            });
                        } else if (param.type === 'ArrayPattern') {
                            // Handle array destructuring
                            param.elements.forEach((element: any) => {
                                if (element && element.type === 'Identifier') {
                                    functionScope.add(element.name);
                                    localVariables.add(element.name);
                                }
                            });
                        }
                    });
                }

                // Traverse the function body with the new scope
                if (node.body) {
                    if (node.body.type === 'BlockStatement') {
                        traverse(node.body, functionScope);
                    } else {
                        // For arrow functions with expression bodies
                        traverse(node.body, functionScope);
                    }
                }

                return; // Skip the default traversal since we've handled it
            }

            // Handle variable declarations
            if (node.type === 'VariableDeclaration') {
                node.declarations.forEach((decl: any) => {
                    if (decl.id.type === 'Identifier') {
                        scope.add(decl.id.name);
                        localVariables.add(decl.id.name);
                    } else if (decl.id.type === 'ObjectPattern') {
                        // Handle object destructuring
                        decl.id.properties.forEach((prop: any) => {
                            if (prop.value && prop.value.type === 'Identifier') {
                                scope.add(prop.value.name);
                                localVariables.add(prop.value.name);
                            }
                        });
                    } else if (decl.id.type === 'ArrayPattern') {
                        // Handle array destructuring
                        decl.id.elements.forEach((element: any) => {
                            if (element && element.type === 'Identifier') {
                                scope.add(element.name);
                                localVariables.add(element.name);
                            }
                        });
                    }

                    // Traverse the initializer
                    if (decl.init) {
                        traverse(decl.init, scope);
                    }
                });

                return; // Skip default traversal
            }

            // Handle class declarations
            if (node.type === 'ClassDeclaration') {
                if (node.id && node.id.name) {
                    localVariables.add(node.id.name);
                }

                // Traverse class body
                if (node.body && node.body.body) {
                    node.body.body.forEach((member: any) => {
                        traverse(member, scope);
                    });
                }

                return; // Skip default traversal
            }

            // Check for identifiers that might be dependencies
            if (node.type === 'Identifier') {
                const name = node.name;

                // If the identifier is not in the current scope, not a defined symbol, and not a built-in, it's a dependency
                if (!scope.has(name) && !definedSymbols.has(name) && !localVariables.has(name) && !builtInsAndKeywords.has(name)) {
                    dependencies.add(name);
                }
            }

            // Handle member expressions (e.g., object.property)
            if (node.type === 'MemberExpression' && node.object.type === 'Identifier') {
                const objectName = node.object.name;

                // If the object is not in scope and not a built-in, it's a dependency
                if (!scope.has(objectName) && !definedSymbols.has(objectName) && !localVariables.has(objectName) && !builtInsAndKeywords.has(objectName)) {
                    dependencies.add(objectName);
                }
            }

            // Recursively traverse child nodes with the current scope
            for (const key in node) {
                if (node.hasOwnProperty(key) && key !== 'loc' && key !== 'range' && key !== 'comments') {
                    const child = (node as any)[key];
                    if (typeof child === 'object' && child !== null) {
                        if (Array.isArray(child)) {
                            child.forEach(item => traverse(item, scope));
                        } else {
                            traverse(child, scope);
                        }
                    }
                }
            }
        }

        // Start traversal from the nodes to move
        nodesToMove.forEach(node => traverse(node));


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
                // Don't include comments in the export declaration to avoid "export // comment" syntax
                const nodeWithoutComments = { ...node };
                if (nodeWithoutComments.comments) {
                    delete nodeWithoutComments.comments;
                }
                return jscodeshift.exportNamedDeclaration(nodeWithoutComments)
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
        let modifiedTargetCode = targetAst.toSource({ quote: "single" })

        // Remove the nodes from the source AST
        nodesToRemove.forEach(nodePath => {
            nodePath.prune()
        })

        // Generate the modified source code
        let modifiedSourceCode = sourceAst.toSource({ quote: "single" })

        // Clean up any orphaned closing braces that might be left behind
        modifiedSourceCode = cleanupOrphanedBraces(modifiedSourceCode)

        // Add imports for moved code if there are exported names
        let importsAdded = false;
        if (exportedNames.length > 0) {
            // Create a relative path for the import statement
            const sourceDir = path.dirname(options.sourceFilePath);
            const targetDir = path.dirname(options.targetFilePath);
            const targetFile = path.basename(options.targetFilePath, path.extname(options.targetFilePath));

            // Calculate relative path from source to target
            let relativePath = path.relative(sourceDir, targetDir);
            if (!relativePath) {
                relativePath = '.'; // Same directory
            }

            // Create the import path
            const importPath = `${relativePath}/${targetFile}`.replace(/\\/g, '/');
            const finalImportPath = importPath.startsWith('.') ? importPath : `./${importPath}`;

            // Create import statement
            const importStatement = `import { ${exportedNames.join(', ')} } from '${finalImportPath}';\n`;

            // Add import statement to the beginning of the source file
            modifiedSourceCode = importStatement + modifiedSourceCode;
            importsAdded = true;
        }

        // Add imports for dependencies in the target file
        let dependenciesImported = false;
        const dependenciesToImport = Array.from(dependencies).filter(dep => !definedSymbols.has(dep));

        if (dependenciesToImport.length > 0) {
            // Create a relative path for the import statement
            const targetDir = path.dirname(options.targetFilePath);
            const sourceDir = path.dirname(options.sourceFilePath);
            const sourceFile = path.basename(options.sourceFilePath, path.extname(options.sourceFilePath));

            // Calculate relative path from target to source
            let relativePath = path.relative(targetDir, sourceDir);
            if (!relativePath) {
                relativePath = '.'; // Same directory
            }

            // Create the import path
            const importPath = `${relativePath}/${sourceFile}`.replace(/\\/g, '/');
            const finalImportPath = importPath.startsWith('.') ? importPath : `./${importPath}`;

            // Create import statement for the target file
            const dependencyImportStatement = `import { ${dependenciesToImport.join(', ')} } from '${finalImportPath}';\n`;

            // Add import statement to the beginning of the target file
            const modifiedTargetCodeWithImports = dependencyImportStatement + modifiedTargetCode;

            // Update the modified target code
            modifiedTargetCode = modifiedTargetCodeWithImports;
            dependenciesImported = true;
        }

        return {
            success: true,
            modifiedSourceCode,
            modifiedTargetCode,
            movedNodes: nodesToMove.length,
            importsAdded,
            exportedNames,
            dependenciesImported: dependenciesImported,
            dependencies: dependenciesToImport
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