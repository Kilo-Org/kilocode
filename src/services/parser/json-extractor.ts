// kilocode_change - new file

import { Node } from "web-tree-sitter"
import { BaseSymbolExtractor, ParsedFile, SymbolInfo, RelationshipInfo, ScopeInfo } from "./symbol-extractor"

/**
 * JSON symbol extractor for configuration files and data structures
 */
export class JsonSymbolExtractor extends BaseSymbolExtractor {
	extractSymbols(filePath: string, content: string, tree: Node): ParsedFile {
		const symbols: SymbolInfo[] = []
		const relationships: RelationshipInfo[] = []
		const dependencies: string[] = []

		this.traverseTree(tree, content, symbols, relationships, dependencies, filePath, null)

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

		this.traverseForDependencies(tree, content, dependencies)

		return dependencies
	}

	private traverseTree(
		node: Node,
		content: string,
		symbols: SymbolInfo[],
		relationships: RelationshipInfo[],
		dependencies: string[],
		filePath: string,
		parentSymbolId: string | null,
	): void {
		switch (node.type) {
			case "object":
				this.extractObject(node, content, symbols, relationships, dependencies, filePath, parentSymbolId)
				break
			case "array":
				this.extractArray(node, content, symbols, relationships, dependencies, filePath, parentSymbolId)
				break
			case "pair":
				this.extractPair(node, content, symbols, relationships, dependencies, filePath, parentSymbolId)
				break
		}

		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child) {
				this.traverseTree(child, content, symbols, relationships, dependencies, filePath, parentSymbolId)
			}
		}
	}

	private extractObject(
		node: Node,
		content: string,
		symbols: SymbolInfo[],
		relationships: RelationshipInfo[],
		dependencies: string[],
		filePath: string,
		parentSymbolId: string | null,
	): void {
		const objectName = this.extractObjectName(node, parentSymbolId)
		const symbolId = this.generateSymbolId(objectName, filePath, node.startPosition.row)
		const metadata = this.extractMetadata(node, content)

		metadata.jsonType = "object"
		metadata.size = this.estimateObjectSize(node) || undefined

		const symbol: SymbolInfo = {
			id: symbolId,
			name: objectName,
			type: "class", // JSON objects are treated as classes
			filePath,
			startLine: node.startPosition.row,
			endLine: node.endPosition.row,
			parentSymbolId: parentSymbolId || undefined,
			metadata,
		}

		symbols.push(symbol)

		// Extract child properties
		this.extractObjectProperties(node, content, symbols, relationships, dependencies, filePath, symbolId)
	}

	private extractArray(
		node: Node,
		content: string,
		symbols: SymbolInfo[],
		relationships: RelationshipInfo[],
		dependencies: string[],
		filePath: string,
		parentSymbolId: string | null,
	): void {
		const arrayName = this.extractArrayName(node, parentSymbolId)
		const symbolId = this.generateSymbolId(arrayName, filePath, node.startPosition.row)
		const metadata = this.extractMetadata(node, content)

		metadata.jsonType = "array"
		metadata.length = this.estimateArrayLength(node) || undefined

		const symbol: SymbolInfo = {
			id: symbolId,
			name: arrayName,
			type: "variable", // Arrays are treated as variables
			filePath,
			startLine: node.startPosition.row,
			endLine: node.endPosition.row,
			parentSymbolId: parentSymbolId || undefined,
			metadata,
		}

		symbols.push(symbol)

		// Extract array elements
		this.extractArrayElements(node, content, symbols, relationships, dependencies, filePath, symbolId)
	}

	private extractPair(
		node: Node,
		content: string,
		symbols: SymbolInfo[],
		relationships: RelationshipInfo[],
		dependencies: string[],
		filePath: string,
		parentSymbolId: string | null,
	): void {
		const key = this.extractPairKey(node)
		const value = this.extractPairValue(node, content)

		if (!key) return

		const symbolId = this.generateSymbolId(key, filePath, node.startPosition.row)
		const metadata = this.extractMetadata(node, content)

		metadata.jsonType = "property"
		metadata.value = value
		metadata.valueType = this.getValueType(node)

		const symbol: SymbolInfo = {
			id: symbolId,
			name: key,
			type: this.determinePropertyType(key, value),
			filePath,
			startLine: node.startPosition.row,
			endLine: node.endPosition.row,
			parentSymbolId: parentSymbolId || undefined,
			metadata,
		}

		symbols.push(symbol)

		// Check for external references in the value
		if (typeof value === "string" && this.isExternalReference(value)) {
			dependencies.push(value)
		}
	}

	private extractObjectProperties(
		node: Node,
		content: string,
		symbols: SymbolInfo[],
		relationships: RelationshipInfo[],
		dependencies: string[],
		filePath: string,
		parentSymbolId: string,
	): void {
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child && child.type === "pair") {
				this.extractPair(child, content, symbols, relationships, dependencies, filePath, parentSymbolId)
			}
		}
	}

	private extractArrayElements(
		node: Node,
		content: string,
		symbols: SymbolInfo[],
		relationships: RelationshipInfo[],
		dependencies: string[],
		filePath: string,
		parentSymbolId: string,
	): void {
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child) {
				const elementName = `element_${i}`
				const symbolId = this.generateSymbolId(elementName, filePath, child.startPosition.row)
				const metadata = this.extractMetadata(child, content)

				metadata.jsonType = "array_element"
				metadata.index = i
				metadata.value = this.getNodeText(child, content)

				const symbol: SymbolInfo = {
					id: symbolId,
					name: elementName,
					type: "variable",
					filePath,
					startLine: child.startPosition.row,
					endLine: child.endPosition.row,
					parentSymbolId,
					metadata,
				}

				symbols.push(symbol)
			}
		}
	}

	private traverseForDependencies(node: Node, content: string, dependencies: string[]): void {
		if (node.type === "pair") {
			const value = this.extractPairValue(node, content)
			if (typeof value === "string" && this.isExternalReference(value)) {
				dependencies.push(value)
			}
		}

		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child) {
				this.traverseForDependencies(child, content, dependencies)
			}
		}
	}

	private extractObjectName(node: Node, parentSymbolId: string | null): string {
		if (parentSymbolId) {
			return `${parentSymbolId}_object`
		}
		return "root_object"
	}

	private extractArrayName(node: Node, parentSymbolId: string | null): string {
		if (parentSymbolId) {
			return `${parentSymbolId}_array`
		}
		return "root_array"
	}

	private extractPairKey(node: Node): string | null {
		const keyNode = node.childForFieldName("key")
		if (keyNode) {
			return this.getNodeText(keyNode, "").replace(/['"]/g, "")
		}
		return null
	}

	private extractPairValue(node: Node, content: string): any {
		const valueNode = node.childForFieldName("value")
		if (valueNode) {
			const valueText = this.getNodeText(valueNode, content)

			// Try to parse the value
			try {
				return JSON.parse(valueText)
			} catch {
				return valueText
			}
		}
		return null
	}

	private getValueType(node: Node): string {
		const valueNode = node.childForFieldName("value")
		if (valueNode) {
			return valueNode.type
		}
		return "unknown"
	}

	private determinePropertyType(key: string, value: any): "class" | "function" | "method" | "variable" | "import" {
		// Determine type based on key name and value
		if (key.includes("class") || key.includes("model")) {
			return "class"
		}
		if (key.includes("function") || key.includes("method") || key.includes("handler")) {
			return "function"
		}
		if (typeof value === "string" && value.includes("import")) {
			return "import"
		}

		return "variable"
	}

	private isExternalReference(value: string): boolean {
		return value.includes("://") || value.includes("./") || value.includes("../")
	}

	private estimateObjectSize(node: Node): number {
		let size = 0
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child && child.type === "pair") {
				size++
			}
		}
		return size
	}

	private estimateArrayLength(node: Node): number {
		let length = 0
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child) {
				length++
			}
		}
		return length
	}

	private generateContext(symbol: SymbolInfo, children: SymbolInfo[]): string {
		const context = [`${symbol.type} ${symbol.name}`]

		if (symbol.metadata.jsonType) {
			context.push(`Type: ${symbol.metadata.jsonType}`)
		}

		if (children.length > 0) {
			context.push(`Contains: ${children.map((c) => c.name).join(", ")}`)
		}

		if (symbol.metadata.value !== undefined) {
			context.push(`Value: ${JSON.stringify(symbol.metadata.value)}`)
		}

		if (symbol.metadata.size !== undefined) {
			context.push(`Size: ${symbol.metadata.size}`)
		}

		if (symbol.metadata.length !== undefined) {
			context.push(`Length: ${symbol.metadata.length}`)
		}

		return context.join(" | ")
	}
}
