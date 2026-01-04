// kilocode_change - new file

import { Node } from "web-tree-sitter"
import { BaseSymbolExtractor, ParsedFile, SymbolInfo, RelationshipInfo, ScopeInfo } from "./symbol-extractor"

/**
 * Python-specific symbol extractor with Odoo pattern detection
 */
export class PythonSymbolExtractor extends BaseSymbolExtractor {
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

		// Find the symbol that contains the given line
		const containingSymbol = symbols.find((symbol) => symbol.startLine <= line && symbol.endLine >= line)

		if (!containingSymbol) {
			return null
		}

		// Find child symbols
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
			case "class_definition":
				this.extractClass(node, content, symbols, relationships, filePath)
				break
			case "function_definition":
				this.extractFunction(node, content, symbols, relationships, filePath)
				break
			case "decorated_definition":
				this.extractDecoratedDefinition(node, content, symbols, relationships, filePath)
				break
			case "import_statement":
			case "import_from_statement":
				this.extractImport(node, content, dependencies)
				break
			case "assignment":
				this.extractVariable(node, content, symbols, filePath)
				break
		}

		// Recursively traverse children
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

		// Check for Odoo-specific patterns
		this.extractOdooClassMetadata(node, content, metadata)

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

		// Extract inheritance relationships
		this.extractInheritanceRelationships(node, symbolId, relationships, filePath)
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

		// Check for Odoo API decorators
		this.extractOdooFunctionMetadata(node, content, metadata)

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

	private extractDecoratedDefinition(
		node: Node,
		content: string,
		symbols: SymbolInfo[],
		relationships: RelationshipInfo[],
		filePath: string,
	): void {
		// Handle decorated functions/methods (common in Odoo)
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child && (child.type === "function_definition" || child.type === "class_definition")) {
				this.extractFunction(child, content, symbols, relationships, filePath)
			}
		}
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

	private traverseForImports(node: Node, content: string, dependencies: string[]): void {
		if (node.type === "import_statement" || node.type === "import_from_statement") {
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

	private extractVariableName(node: Node): string | null {
		const leftChild = node.childForFieldName("left")
		if (leftChild && leftChild.type === "identifier") {
			return this.getNodeText(leftChild, "")
		}
		return null
	}

	private extractOdooClassMetadata(node: Node, content: string, metadata: Record<string, any>): void {
		// Look for Odoo class attributes like _name, _inherit, _description
		this.traverseForOdooAttributes(node, content, metadata)
	}

	private extractOdooFunctionMetadata(node: Node, content: string, metadata: Record<string, any>): void {
		// Look for Odoo API decorators
		const parent = node.parent
		if (parent && parent.type === "decorated_definition") {
			this.extractOdooDecorators(parent, content, metadata)
		}
	}

	private traverseForOdooAttributes(node: Node, content: string, metadata: Record<string, any>): void {
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child && child.type === "block") {
				this.searchOdooAttributesInBlock(child, content, metadata)
			}
		}
	}

	private searchOdooAttributesInBlock(node: Node, content: string, metadata: Record<string, any>): void {
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child && child.type === "expression_statement") {
				this.checkForOdooAttribute(child, content, metadata)
			}
		}
	}

	private checkForOdooAttribute(node: Node, content: string, metadata: Record<string, any>): void {
		const assignment = node.childForFieldName("left")
		if (assignment && assignment.type === "assignment") {
			const left = assignment.childForFieldName("left")
			const right = assignment.childForFieldName("right")

			if (left && left.type === "identifier" && right) {
				const attrName = this.getNodeText(left, "")
				if (attrName.startsWith("_")) {
					const attrValue = this.getNodeText(right, content)
					metadata[attrName] = this.cleanAttributeValue(attrValue)
				}
			}
		}
	}

	private extractOdooDecorators(node: Node, content: string, metadata: Record<string, any>): void {
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child && child.type === "decorator") {
				const decoratorText = this.getNodeText(child, content)
				if (decoratorText.includes("@api")) {
					metadata.odooApi = true
					metadata.decorator = decoratorText
				}
			}
		}
	}

	private cleanAttributeValue(value: string): string {
		return value.replace(/['"]/g, "").trim()
	}

	private extractInheritanceRelationships(
		node: Node,
		symbolId: string,
		relationships: RelationshipInfo[],
		filePath: string,
	): void {
		// Look for inheritance in class arguments
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child && child.type === "argument_list") {
				this.extractParentClasses(child, symbolId, relationships, filePath)
			}
		}
	}

	private extractParentClasses(
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

		if (symbol.metadata._name) {
			context.push(`Odoo Model: ${symbol.metadata._name}`)
		}

		if (symbol.metadata._inherit) {
			context.push(`Inherits: ${symbol.metadata._inherit}`)
		}

		return context.join(" | ")
	}
}
