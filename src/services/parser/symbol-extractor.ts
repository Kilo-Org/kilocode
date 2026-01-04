// kilocode_change - new file

import { Node } from "web-tree-sitter"
import { DatabaseManager } from "../storage/database-manager"

export interface SymbolInfo {
	id: string
	name: string
	type: "class" | "function" | "method" | "variable" | "import"
	filePath: string
	startLine: number
	endLine: number
	parentSymbolId?: string
	metadata: Record<string, any>
}

export interface RelationshipInfo {
	id: string
	fromSymbolId: string
	toSymbolId: string
	type: "CALLS" | "INHERITS" | "IMPORTS" | "REFERENCES"
	metadata?: Record<string, any>
}

export interface ScopeInfo {
	symbol: SymbolInfo
	children: SymbolInfo[]
	context: string
}

export interface ParsedFile {
	filePath: string
	symbols: SymbolInfo[]
	relationships: RelationshipInfo[]
	dependencies: string[]
}

/**
 * Base symbol extractor interface for different languages
 */
export interface ISymbolExtractor {
	extractSymbols(filePath: string, content: string, tree: Node): ParsedFile
	getScope(filePath: string, content: string, tree: Node, line: number): ScopeInfo | null
	getDependencies(filePath: string, content: string, tree: Node): string[]
}

/**
 * Base class for language-specific symbol extractors
 */
export abstract class BaseSymbolExtractor implements ISymbolExtractor {
	protected databaseManager: DatabaseManager

	constructor(databaseManager: DatabaseManager) {
		this.databaseManager = databaseManager
	}

	abstract extractSymbols(filePath: string, content: string, tree: Node): ParsedFile
	abstract getScope(filePath: string, content: string, tree: Node, line: number): ScopeInfo | null
	abstract getDependencies(filePath: string, content: string, tree: Node): string[]

	/**
	 * Generate a unique symbol ID
	 */
	protected generateSymbolId(name: string, filePath: string, startLine: number): string {
		return `${name}:${filePath}:${startLine}`
	}

	/**
	 * Generate a unique relationship ID
	 */
	protected generateRelationshipId(fromId: string, toId: string, type: string): string {
		return `${fromId}->${toId}:${type}`
	}

	/**
	 * Extract text content from a node
	 */
	protected getNodeText(node: Node, content: string): string {
		return content.substring(node.startIndex, node.endIndex)
	}

	/**
	 * Find parent symbol for a given node
	 */
	protected findParentSymbol(node: Node, symbols: SymbolInfo[]): SymbolInfo | null {
		let current: Node | null = node
		while (current) {
			const parentSymbol = symbols.find(
				(s) => s.startLine <= current!.startPosition.row && s.endLine >= current!.endPosition.row,
			)
			if (parentSymbol) {
				return parentSymbol
			}
			current = current.parent
		}
		return null
	}

	/**
	 * Extract metadata from node
	 */
	protected extractMetadata(node: Node, content: string): Record<string, any> {
		const metadata: Record<string, any> = {}

		// Basic node information
		metadata.nodeType = node.type
		metadata.startPosition = node.startPosition
		metadata.endPosition = node.endPosition

		return metadata
	}
}
