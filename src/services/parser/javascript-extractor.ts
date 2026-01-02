// kilocode_change - new file

import { Node } from "web-tree-sitter"
import { BaseSymbolExtractor, ParsedFile, SymbolInfo, RelationshipInfo, ScopeInfo } from "./symbol-extractor"

/**
 * JavaScript/TypeScript symbol extractor
 */
export class JavaScriptSymbolExtractor extends BaseSymbolExtractor {
	extractSymbols(filePath: string, content: string, tree: Node): ParsedFile {
		const symbols: SymbolInfo[] = []
		const relationships: RelationshipInfo[] = []
		const dependencies: string[] = []

		this.traverseTree(tree, content, symbols, relationships, dependencies, filePath)

		return {
			filePath,
			symbols,
			relationships,
			dependencies,
		}
	}

	getScope(filePath: string, content: string, tree: Node, line: number): ScopeInfo | null {
		const symbols = this.extractSymbols(filePath, content, tree).symbols

		const containingSymbol = symbols.find((symbol) => symbol.startLine <= line && symbol.endLine >= line)

		if (!containingSymbol) {
			return null
		}

		const children = symbols.filter((symbol) => symbol.parentSymbolId === containingSymbol.id)

		return {
			symbol: containingSymbol,
			children,
			context: this.generateContext(containingSymbol, children),
		}
	}

	getDependencies(filePath: string, content: string, tree: Node): string[] {
		const dependencies: string[] = []

		this.traverseForImports(tree, content, dependencies)

		return dependencies
	}

	private traverseTree(
		node: Node,
		content: string,
		symbols: SymbolInfo[],
		relationships: RelationshipInfo[],
		dependencies: string[],
		filePath: string,
	): void {
		switch (node.type) {
			case "class_declaration":
			case "class_expression":
				this.extractClass(node, content, symbols, relationships, filePath)
				break
			case "function_declaration":
			case "function_expression":
			case "arrow_function":
				this.extractFunction(node, content, symbols, relationships, filePath)
				break
			case "method_definition":
				this.extractMethod(node, content, symbols, relationships, filePath)
				break
			case "lexical_declaration":
			case "variable_declaration":
				this.extractVariable(node, content, symbols, filePath)
				break
			case "import_statement":
			case "import_expression":
				this.extractImport(node, content, dependencies)
				break
			case "export_statement":
				this.extractExport(node, content, dependencies)
				break
		}

		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child) {
				this.traverseTree(child, content, symbols, relationships, dependencies, filePath)
			}
		}
	}

	private extractClass(
		node: Node,
		content: string,
		symbols: SymbolInfo[],
		relationships: RelationshipInfo[],
		filePath: string,
	): void {
		const className = this.extractClassName(node)
		if (!className) return

		const symbolId = this.generateSymbolId(className, filePath, node.startPosition.row)
		const metadata = this.extractMetadata(node, content)

		const symbol: SymbolInfo = {
			id: symbolId,
			name: className,
			type: "class",
			filePath,
			startLine: node.startPosition.row,
			endLine: node.endPosition.row,
			metadata,
		}

		symbols.push(symbol)

		// Extract inheritance/extension relationships
		this.extractClassRelationships(node, symbolId, relationships, filePath)
	}

	private extractFunction(
		node: Node,
		content: string,
		symbols: SymbolInfo[],
		relationships: RelationshipInfo[],
		filePath: string,
	): void {
		const functionName = this.extractFunctionName(node)
		if (!functionName) return

		const symbolId = this.generateSymbolId(functionName, filePath, node.startPosition.row)
		const metadata = this.extractMetadata(node, content)

		const symbol: SymbolInfo = {
			id: symbolId,
			name: functionName,
			type: "function",
			filePath,
			startLine: node.startPosition.row,
			endLine: node.endPosition.row,
			metadata,
		}

		symbols.push(symbol)
	}

	private extractMethod(
		node: Node,
		content: string,
		symbols: SymbolInfo[],
		relationships: RelationshipInfo[],
		filePath: string,
	): void {
		const methodName = this.extractMethodName(node)
		if (!methodName) return

		const symbolId = this.generateSymbolId(methodName, filePath, node.startPosition.row)
		const metadata = this.extractMetadata(node, content)

		// Find parent class
		const parentClass = this.findParentClass(node)
		if (parentClass) {
			const parentSymbolId = this.generateSymbolId(parentClass, filePath, node.startPosition.row)
			metadata.parentClass = parentClass
		}

		const symbol: SymbolInfo = {
			id: symbolId,
			name: methodName,
			type: "method",
			filePath,
			startLine: node.startPosition.row,
			endLine: node.endPosition.row,
			metadata,
		}

		symbols.push(symbol)
	}

	private extractVariable(node: Node, content: string, symbols: SymbolInfo[], filePath: string): void {
		const variableName = this.extractVariableName(node)
		if (!variableName) return

		const symbolId = this.generateSymbolId(variableName, filePath, node.startPosition.row)
		const metadata = this.extractMetadata(node, content)

		const symbol: SymbolInfo = {
			id: symbolId,
			name: variableName,
			type: "variable",
			filePath,
			startLine: node.startPosition.row,
			endLine: node.endPosition.row,
			metadata,
		}

		symbols.push(symbol)
	}

	private extractImport(node: Node, content: string, dependencies: string[]): void {
		const importText = this.getNodeText(node, content).trim()
		if (importText) {
			dependencies.push(importText)
		}
	}

	private extractExport(node: Node, content: string, dependencies: string[]): void {
		const exportText = this.getNodeText(node, content).trim()
		if (exportText) {
			dependencies.push(exportText)
		}
	}

	private traverseForImports(node: Node, content: string, dependencies: string[]): void {
		if (node.type === "import_statement" || node.type === "import_expression" || node.type === "export_statement") {
			this.extractImport(node, content, dependencies)
		}

		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child) {
				this.traverseForImports(child, content, dependencies)
			}
		}
	}

	private extractClassName(node: Node): string | null {
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child && child.type === "identifier") {
				return this.getNodeText(child, "")
			}
		}
		return null
	}

	private extractFunctionName(node: Node): string | null {
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child && child.type === "identifier") {
				return this.getNodeText(child, "")
			}
		}
		return null
	}

	private extractMethodName(node: Node): string | null {
		const propertyId = node.childForFieldName("name")
		if (propertyId && propertyId.type === "property_identifier") {
			return this.getNodeText(propertyId, "")
		}
		return null
	}

	private extractVariableName(node: Node): string | null {
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child && child.type === "variable_declarator") {
				const identifier = child.childForFieldName("name")
				if (identifier && identifier.type === "identifier") {
					return this.getNodeText(identifier, "")
				}
			}
		}
		return null
	}

	private findParentClass(node: Node): string | null {
		let current: Node | null = node.parent
		while (current) {
			if (current.type === "class_declaration" || current.type === "class_expression") {
				return this.extractClassName(current)
			}
			current = current.parent
		}
		return null
	}

	private extractClassRelationships(
		node: Node,
		symbolId: string,
		relationships: RelationshipInfo[],
		filePath: string,
	): void {
		// Look for heritage clauses (extends, implements)
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child && child.type === "heritage_clause") {
				this.extractHeritageRelationships(child, symbolId, relationships, filePath)
			}
		}
	}

	private extractHeritageRelationships(
		node: Node,
		symbolId: string,
		relationships: RelationshipInfo[],
		filePath: string,
	): void {
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child && child.type === "identifier") {
				const parentClassName = this.getNodeText(child, "")
				const parentSymbolId = this.generateSymbolId(parentClassName, filePath, child.startPosition.row)

				const relationship: RelationshipInfo = {
					id: this.generateRelationshipId(symbolId, parentSymbolId, "INHERITS"),
					fromSymbolId: symbolId,
					toSymbolId: parentSymbolId,
					type: "INHERITS",
					metadata: { inheritanceType: "class" },
				}

				relationships.push(relationship)
			}
		}
	}

	private generateContext(symbol: SymbolInfo, children: SymbolInfo[]): string {
		const context = [`${symbol.type} ${symbol.name}`]

		if (children.length > 0) {
			context.push(`Contains: ${children.map((c) => c.name).join(", ")}`)
		}

		if (symbol.metadata.parentClass) {
			context.push(`Parent: ${symbol.metadata.parentClass}`)
		}

		return context.join(" | ")
	}
}
