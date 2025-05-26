/**
 * Core types and interfaces for code transformation operations
 */

export interface SymbolInfo {
    name: string;
    type: 'function' | 'class' | 'variable' | 'const' | 'let' | 'var' | 'interface' | 'type' | 'enum';
    isExported: boolean;
    node: any;
    line: number;
}

export interface CodeBlock {
    startLine: number;
    endLine: number;
    content: string;
    exportedNames: string[];
    dependencies: string[];
    comments: string[];
    symbols: SymbolInfo[];
    referencedSymbols: Set<string>; // Symbols this block references
}

export interface FileOperation {
    sourceFilePath: string;
    targetFilePath: string;
    codeBlocks: CodeBlock[];
}

export interface DependencyGraph {
    nodes: Map<string, Set<string>>; // file -> dependencies
    getProcessingOrder(): string[];
    hasCycle(): boolean;
}

export interface MoveOperation {
    sourceFilePath: string;
    targetFilePath: string;
    startLine: number;
    endLine: number;
}