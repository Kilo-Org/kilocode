import * as jscodeshiftModule from 'jscodeshift';
const jscodeshift = jscodeshiftModule.default;
import { extractExportNames, extractTypeReferences } from './exports';
import { collectDependencies } from './dependencies';
import { Scope } from './Scope';
import { CodeBlock, SymbolInfo } from './types';

/**
 * Analyzes code blocks to extract symbols, dependencies, and references
 */
export class CodeAnalyzer {
    private parser: string;

    constructor(isTypeScript: boolean) {
        this.parser = isTypeScript ? "tsx" : "babel";
    }

    /**
     * Analyzes a code block to extract symbols, dependencies, and references
     */
    analyzeCodeBlock(content: string, startLine: number, endLine: number): CodeBlock {
        try {
            // Add safeguard against huge files
            if (content.length > 100000) {
                content = content.substring(0, 100000);
            }

            const ast = jscodeshift.withParser(this.parser)(content);
            const nodes = ast.find(jscodeshift.Node).paths().map(path => path.node);

            // Get exported names
            const exportedNames = extractExportNames(nodes);
            const typeReferences = extractTypeReferences(ast, nodes);

            // Collect all top-level function and variable names that are being moved
            const movedSymbols = new Set<string>();
            const symbols: SymbolInfo[] = [];

            // IMPORTANT: Limit collection depth to avoid stack overflow
            // Find all function declarations - with simplified structure to avoid recursion
            ast.find(jscodeshift.FunctionDeclaration).forEach(path => {
                try {
                    const node = path.node;
                    if (node.id && typeof node.id === 'object' && 'name' in node.id && typeof node.id.name === 'string') {
                        movedSymbols.add(node.id.name);
                        symbols.push({
                            name: node.id.name,
                            type: 'function',
                            isExported: this.isNodeExported(path),
                            node: path.node,
                            line: (path.node.loc?.start.line || 0) + startLine - 1
                        });
                    }

                    // Non-recursive collection of nested functions
                    this.collectNestedFunctions(path, movedSymbols, 0);
                } catch (e) {
                    // Silently ignore individual function parsing errors
                }
            });

            // Find all variable declarations
            ast.find(jscodeshift.VariableDeclaration).forEach(path => {
                const node = path.node;
                const kind = node.kind as 'const' | 'let' | 'var';
                const isExported = this.isNodeExported(path);

                node.declarations.forEach((decl: any) => {
                    if (decl.id && decl.id.type === 'Identifier' && decl.id.name) {
                        movedSymbols.add(decl.id.name);
                        symbols.push({
                            name: decl.id.name,
                            type: kind,
                            isExported,
                            node: decl,
                            line: (node.loc?.start.line || 0) + startLine - 1
                        });
                    } else if (decl.id?.type === 'ObjectPattern') {
                        // Handle destructuring patterns
                        decl.id.properties?.forEach((prop: any) => {
                            if (prop.type === 'Property' && prop.key?.type === 'Identifier') {
                                movedSymbols.add(prop.key.name);
                                symbols.push({
                                    name: prop.key.name,
                                    type: kind,
                                    isExported,
                                    node: prop,
                                    line: (node.loc?.start.line || 0) + startLine - 1
                                });
                            }
                        });
                    }
                });
            });

            // Find all class declarations
            ast.find(jscodeshift.ClassDeclaration).forEach(path => {
                const node = path.node;
                if (node.id && typeof node.id === 'object' && 'name' in node.id && typeof node.id.name === 'string') {
                    movedSymbols.add(node.id.name);
                    symbols.push({
                        name: node.id.name,
                        type: 'class',
                        isExported: this.isNodeExported(path),
                        node: path.node,
                        line: (path.node.loc?.start.line || 0) + startLine - 1
                    });
                }
            });

            // Find all TypeScript interfaces
            ast.find(jscodeshift.TSInterfaceDeclaration).forEach((path: any) => {
                if (path.node.id && path.node.id.name) {
                    movedSymbols.add(path.node.id.name);
                    symbols.push({
                        name: path.node.id.name,
                        type: 'interface',
                        isExported: this.isNodeExported(path),
                        node: path.node,
                        line: (path.node.loc?.start.line || 0) + startLine - 1
                    });
                }
            });

            // Find all TypeScript type aliases
            ast.find(jscodeshift.TSTypeAliasDeclaration).forEach((path: any) => {
                if (path.node.id && path.node.id.name) {
                    movedSymbols.add(path.node.id.name);
                    symbols.push({
                        name: path.node.id.name,
                        type: 'type',
                        isExported: this.isNodeExported(path),
                        node: path.node,
                        line: (path.node.loc?.start.line || 0) + startLine - 1
                    });
                }
            });

            // Combine all collected names
            const allMovedNames = [...exportedNames, ...typeReferences.names, ...Array.from(movedSymbols)];
            const definedSymbols = new Set(allMovedNames);

            // Collect dependencies (symbols used but not defined in this code block)
            const scope = new Scope();
            const dependencies = Array.from(collectDependencies(nodes, definedSymbols, scope));

            // Find all references in this block (excluding symbols defined in this block)
            const referencedSymbols = this.findReferences(content, definedSymbols);

            return {
                startLine,
                endLine,
                content: content.trim(),
                exportedNames: allMovedNames, // Include all moved symbols, not just exported ones
                dependencies,
                comments: this.extractComments(content),
                symbols,
                referencedSymbols
            };
        } catch (error) {
            console.warn(`Error analyzing code block: ${error}`);
            return {
                startLine,
                endLine,
                content: content.trim(),
                exportedNames: [],
                dependencies: [],
                comments: [],
                symbols: [],
                referencedSymbols: new Set<string>()
            };
        }
    }

    /**
     * Check if a node is exported
     */
    private isNodeExported(path: any): boolean {
        // Check if the node itself is exported
        if (path.parent?.node?.type === 'ExportNamedDeclaration' ||
            path.parent?.node?.type === 'ExportDefaultDeclaration') {
            return true;
        }

        // Check if there's an export statement for this symbol
        const symbolName = path.node.id?.name;
        if (!symbolName) return false;

        try {
            const program = path.scope.program.path.node;
            return program.body.some((node: any) => {
                if (node.type === 'ExportNamedDeclaration' && node.specifiers) {
                    return node.specifiers.some((spec: any) =>
                        spec.type === 'ExportSpecifier' && spec.local?.name === symbolName
                    );
                }
                return false;
            });
        } catch {
            return false;
        }
    }

    /**
     * Find all symbol references in a code block
     */
    private findReferences(content: string, excludeSymbols: Set<string> = new Set()): Set<string> {
        const references = new Set<string>();

        try {
            const ast = jscodeshift.withParser(this.parser)(content);

            // Find all identifiers
            ast.find(jscodeshift.Identifier).forEach(path => {
                const name = path.node.name;

                // Skip if it's a symbol we're defining in this block
                if (excludeSymbols.has(name)) return;

                // Skip common keywords and built-ins
                if (this.isBuiltInOrKeyword(name)) return;

                // Check if it's being used as a reference (not a declaration)
                if (this.isReference(path)) {
                    references.add(name);
                }
            });

        } catch (error) {
            console.warn(`Error finding references: ${error}`);
        }

        return references;
    }

    /**
     * Check if an identifier is a reference (not a declaration)
     */
    private isReference(path: any): boolean {
        // Simple non-recursive version to avoid stack overflow
        try {
            const parent = path.parent?.node;
            if (!parent) return true;

            // Not a reference if it's a property key
            if (parent.type === 'Property' && parent.key === path.node) {
                return false;
            }

            // Not a reference if it's a function/class/variable declaration
            if ((parent.type === 'FunctionDeclaration' ||
                parent.type === 'ClassDeclaration' ||
                parent.type === 'VariableDeclarator') &&
                parent.id === path.node) {
                return false;
            }

            // Not a reference if it's being imported
            if (parent.type === 'ImportSpecifier') {
                return false;
            }

            return true;
        } catch (error) {
            // If any errors occur during reference checking, assume it is a reference
            // to be safe (better to have unnecessary imports than missing ones)
            return true;
        }
    }

    /**
     * Check if a name is a built-in or keyword
     */
    private isBuiltInOrKeyword(name: string): boolean {
        const builtIns = new Set([
            // JavaScript keywords
            'function', 'const', 'let', 'var', 'if', 'else', 'return', 'true', 'false', 'null', 'undefined',
            'this', 'new', 'class', 'interface', 'type', 'import', 'export', 'from', 'as', 'extends',
            'implements', 'switch', 'case', 'default', 'break', 'continue', 'for', 'while', 'do', 'try',
            'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void', 'await',
            'async', 'yield', 'super', 'static', 'get', 'set', 'constructor',

            // TypeScript types
            'string', 'number', 'boolean', 'any', 'void', 'never', 'unknown', 'object', 'symbol',
            'bigint', 'Array', 'Record', 'Partial', 'Required', 'Pick', 'Omit',
            'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'InstanceType', 'ReadOnly', 'Promise',

            // Common built-ins
            'Date', 'Object', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol',
            'console', 'Math', 'JSON', 'Error', 'RegExp', 'Number', 'String', 'Boolean', 'BigInt',
            'Intl', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
            'cancelAnimationFrame', 'fetch', 'localStorage', 'sessionStorage', 'document', 'window',
            'process', 'Buffer', 'require', 'module', 'exports'
        ]);

        return builtIns.has(name);
    }

    /**
     * Non-recursive function to find nested function declarations
     */
    private collectNestedFunctions(path: any, symbols: Set<string>, _depth = 0) {
        // We're abandoning recursion to avoid stack overflow
        // Just collect top-level nested functions
        if (path.node.body?.body) {
            for (const node of path.node.body.body) {
                if (node.type === 'FunctionDeclaration' && node.id && node.id.name) {
                    symbols.add(node.id.name);
                }
            }
        }
    }

    /**
     * Extract comments from a code block
     */
    private extractComments(content: string): string[] {
        const lines = content.split('\n');
        const comments: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('/*') ||
                trimmed.startsWith('*') || trimmed.startsWith('*/')) {
                comments.push(line);
            }
        }

        return comments;
    }

    /**
     * Find preceding comments for a code block
     */
    findPrecedingComments(sourceLines: string[], startLine: number): number {
        let commentStartLine = startLine;

        while (commentStartLine > 1) {
            const prevLine = sourceLines[commentStartLine - 2].trim();

            if (prevLine.startsWith('/**') || prevLine.startsWith('/*') ||
                prevLine.startsWith('//') || prevLine === '*/' || prevLine.startsWith('*')) {
                commentStartLine--;
            } else if (prevLine === '' && commentStartLine > 2) {
                const lineBefore = sourceLines[commentStartLine - 3].trim();
                if (lineBefore.startsWith('/**') || lineBefore.startsWith('/*') ||
                    lineBefore.startsWith('//')) {
                    commentStartLine--;
                    continue;
                }
                break;
            } else {
                break;
            }
        }

        return commentStartLine;
    }
}