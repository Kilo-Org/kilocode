/**
 * Extract names of exported symbols from a collection of AST nodes
 * Used to generate appropriate import statements after moving code
 *
 * @param nodes Array of AST nodes to extract export names from
 * @returns Array of variable/function/class names that should be exported
 */
export function extractExportNames(nodes: any[]): string[] {
    const exportedNames: string[] = [];
    const definedSymbols = new Set<string>();

    nodes.forEach(node => {
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
                } else if (decl.id && decl.id.type === "ObjectPattern") {
                    // Handle destructured declarations
                    decl.id.properties.forEach((prop: any) => {
                        if (prop.key && prop.key.name) {
                            exportedNames.push(prop.key.name);
                            definedSymbols.add(prop.key.name);
                        }
                    });
                }
            });
        } else if (node.type === "ExportNamedDeclaration") {
            // Handle directly exported declarations
            if (node.declaration) {
                if (node.declaration.id && node.declaration.id.name) {
                    // Functions, classes, etc. with names
                    exportedNames.push(node.declaration.id.name);
                } else if (node.declaration.declarations) {
                    // Variable declarations
                    node.declaration.declarations.forEach((decl: any) => {
                        if (decl.id && decl.id.name) {
                            exportedNames.push(decl.id.name);
                        }
                    });
                }
            } else if (node.specifiers) {
                // Handle export { name } syntax
                node.specifiers.forEach((spec: any) => {
                    if (spec.exported && spec.exported.name) {
                        exportedNames.push(spec.exported.name);
                    }
                });
            }
        }
    });

    return [...new Set(exportedNames)]; // Return unique names
}

/**
 * Extract type references (interfaces, types, enums) from AST that are used by the nodes to move
 *
 * @param ast The AST of the source file
 * @param nodesToMove Array of nodes being moved
 * @returns Object containing names of types and their declaration nodes
 */
export function extractTypeReferences(ast: any, nodesToMove: any[]): { names: string[], nodes: any[] } {
    const typeNames: string[] = [];
    const typeNodes: any[] = [];
    const typeMap = new Map<string, any>();

    // Extract all potential type references from the nodes being moved
    const usedTypes = new Set<string>();

    // Helper function to add type reference if it's used in a type annotation
    const addTypeRef = (typeName: string) => {
        if (typeName && typeof typeName === 'string') {
            usedTypes.add(typeName);
        }
    };

    // Scan for type references in the nodes to be moved
    const scanForTypeRefs = (node: any) => {
        if (!node || typeof node !== 'object') return;

        // Type annotations, parameter types, return types
        if (node.type === 'TSTypeReference' && node.typeName && node.typeName.name) {
            addTypeRef(node.typeName.name);
        }

        // Interfaces, type aliases, enums
        if (node.typeParameters && node.typeParameters.params) {
            node.typeParameters.params.forEach((param: any) => {
                if (param.type === 'TSTypeReference' && param.typeName && param.typeName.name) {
                    addTypeRef(param.typeName.name);
                }
            });
        }

        // Recurse through child nodes
        for (const key in node) {
            if (node.hasOwnProperty(key) && typeof node[key] === 'object' && node[key] !== null) {
                if (Array.isArray(node[key])) {
                    node[key].forEach((item: any) => scanForTypeRefs(item));
                } else {
                    scanForTypeRefs(node[key]);
                }
            }
        }
    };

    // Find all type references in the nodes to be moved
    nodesToMove.forEach(scanForTypeRefs);

    // Find all type declarations in the source AST
    ast.find('TSInterfaceDeclaration').forEach((path: any) => {
        if (path.node.id && path.node.id.name) {
            typeMap.set(path.node.id.name, path.node);
        }
    });

    ast.find('TSTypeAliasDeclaration').forEach((path: any) => {
        if (path.node.id && path.node.id.name) {
            typeMap.set(path.node.id.name, path.node);
        }
    });

    ast.find('TSEnumDeclaration').forEach((path: any) => {
        if (path.node.id && path.node.id.name) {
            typeMap.set(path.node.id.name, path.node);
        }
    });

    // Collect all the type nodes that were referenced
    usedTypes.forEach(typeName => {
        if (typeMap.has(typeName)) {
            typeNames.push(typeName);
            typeNodes.push(typeMap.get(typeName));
        }
    });

    return { names: typeNames, nodes: typeNodes };
}

/**
 * Create an import statement for the specified symbols from a given path
 *
 * @param names Array of symbol names to import
 * @param from Path to import from (without extension)
 * @returns Import statement as a string
 */
export function makeImportStatement(names: string[], from: string): string {
    if (!names.length) {
        return '';
    }

    // Make sure we have unique names only
    const uniqueNames = [...new Set(names)];
    // Sort names for consistent generation
    const sortedNames = uniqueNames.sort();
    const namesList = sortedNames.join(', ');
    return `import { ${namesList} } from '${from}';\n`;
}

/**
 * Create an export statement for the given names
 *
 * @param names Array of names to export
 * @returns Export statement string
 */
export function makeExportStatement(names: string[]): string {
    if (names.length === 0) return '';

    // Make sure we have unique names only
    const uniqueNames = [...new Set(names)];
    const namesList = uniqueNames.join(', ');
    return `export { ${namesList} };`;
}

/**
 * Create direct export statements for functions, classes, etc.
 * This is preferred over the export { name } syntax
 *
 * @param code The source code
 * @param ast The AST of the code
 * @param names Names to export
 * @returns Modified code with direct export statements
 */
export function makeDirectExports(code: string, ast: any, names: string[]): string {
    if (names.length === 0) return code;

    // Find declarations for each name
    const declarations = new Map<string, { type: string, node: any }>();

    // Find function declarations
    ast.find('FunctionDeclaration').forEach((path: any) => {
        if (path.node.id && path.node.id.name && names.includes(path.node.id.name)) {
            declarations.set(path.node.id.name, { type: 'function', node: path.node });
        }
    });

    // Find class declarations
    ast.find('ClassDeclaration').forEach((path: any) => {
        if (path.node.id && path.node.id.name && names.includes(path.node.id.name)) {
            declarations.set(path.node.id.name, { type: 'class', node: path.node });
        }
    });

    // Find variable declarations
    ast.find('VariableDeclaration').forEach((path: any) => {
        if (path.node.declarations) {
            path.node.declarations.forEach((decl: any) => {
                if (decl.id && decl.id.type === 'Identifier' && names.includes(decl.id.name)) {
                    declarations.set(decl.id.name, {
                        type: path.node.kind || 'var',
                        node: decl
                    });
                }
            });
        }
    });

    // For names we couldn't find declarations for, we'll use the regular export statement
    const undeclaredNames = names.filter(name => !declarations.has(name));

    // Process the code line by line
    const lines = code.split('\n');
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let skip = false;

        // Check if this line contains a declaration we want to export
        for (const [name, _] of declarations.entries()) {
            // Look for function/class declaration or variable declaration
            const functionClassRegex = new RegExp(`^\\s*(function|class)\\s+${name}\\b`);
            const variableRegex = new RegExp(`^\\s*(const|let|var)\\s+${name}\\b`);

            if (functionClassRegex.test(line) || variableRegex.test(line)) {
                // Replace with export declaration
                if (line.trim().startsWith('function')) {
                    result.push(line.replace(/function\s+/, 'export function '));
                } else if (line.trim().startsWith('class')) {
                    result.push(line.replace(/class\s+/, 'export class '));
                } else if (variableRegex.test(line)) {
                    // For variables, we need to preserve the const/let/var
                    result.push(line.replace(/(const|let|var)\s+/, 'export $1 '));
                } else {
                    // Fallback
                    result.push(line);
                }
                skip = true;
                break;
            }
        }

        if (!skip) {
            result.push(line);
        }
    }

    // Add export statement for undeclared names if needed
    if (undeclaredNames.length > 0) {
        result.push('');
        result.push(makeExportStatement(undeclaredNames));
    }

    return result.join('\n');
}

/**
 * Ensure code has export statements for all required symbols
 *
 * @param code The source code
 * @param exportNames Array of names that should be exported
 * @returns Modified code with export statements
 */
export function ensureExports(code: string, exportNames: string[]): string {
    if (exportNames.length === 0) return code;

    // Check if we already have export statements for each name
    const lines = code.split('\n');
    const exportedSymbols = new Set<string>();

    // Scan for existing exports
    for (const line of lines) {
        // Check for named export statements: export { name };
        const namedExportMatch = line.match(/export\s+\{([^}]+)\}/);
        if (namedExportMatch && namedExportMatch[1]) {
            const names = namedExportMatch[1].split(',').map(n => n.trim());
            for (const name of names) {
                exportedSymbols.add(name);
            }
        }

        // Check for direct exports: export function name(), export const name, etc.
        const directExportMatch = line.match(/export\s+(function|class|const|let|var|interface|type|enum)\s+(\w+)/);
        if (directExportMatch && directExportMatch[2]) {
            exportedSymbols.add(directExportMatch[2]);
        }

        // Check for default exports
        const defaultExport = line.match(/export\s+default\s+(\w+)/);
        if (defaultExport && defaultExport[1]) {
            exportedSymbols.add(defaultExport[1]);
        }
    }

    // Collect names that still need to be exported
    const missingExports = exportNames.filter(name => !exportedSymbols.has(name) && name.trim() !== '');

    if (missingExports.length === 0) {
        return code; // All symbols already exported
    }

    // Try to convert existing declarations to direct exports first
    let result = code;

    // Parse the code to find declarations
    try {
        const ast = require('jscodeshift').withParser('tsx')(code);
        result = makeDirectExports(code, ast, missingExports);

        // Check if we still have missing exports after direct conversion
        const directExportedSymbols = new Set<string>(exportedSymbols);
        const lines = result.split('\n');

        for (const line of lines) {
            const directExportMatch = line.match(/export\s+(function|class|const|let|var|interface|type|enum)\s+(\w+)/);
            if (directExportMatch && directExportMatch[2]) {
                directExportedSymbols.add(directExportMatch[2]);
            }
        }

        const stillMissingExports = missingExports.filter(name => !directExportedSymbols.has(name) && name.trim() !== '');

        if (stillMissingExports.length > 0) {
            // Add export statement for still missing exports
            result = result.trim();
            if (result && !result.endsWith('\n')) {
                result += '\n\n';
            } else if (result) {
                result += '\n';
            }

            result += makeExportStatement(stillMissingExports);
        }

        return result;
    } catch (error) {
        // Fallback to simple export statement if parsing fails
        result = code.trim();
        if (result && !result.endsWith('\n')) {
            result += '\n\n';
        } else if (result) {
            result += '\n';
        }

        return result + makeExportStatement(missingExports);
    }
}