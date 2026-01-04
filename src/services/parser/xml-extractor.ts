// kilocode_change - new file

import { Node } from "web-tree-sitter"
import { BaseSymbolExtractor, ParsedFile, SymbolInfo, RelationshipInfo, ScopeInfo } from "./symbol-extractor"

/**
 * XML symbol extractor with Odoo view definition support
 */
export class XmlSymbolExtractor extends BaseSymbolExtractor {
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
	): void {
		switch (node.type) {
			case "element":
				this.extractElement(node, content, symbols, relationships, filePath)
				break
		}

		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child) {
				this.traverseTree(child, content, symbols, relationships, dependencies, filePath)
			}
		}
	}

	private extractElement(
		node: Node,
		content: string,
		symbols: SymbolInfo[],
		relationships: RelationshipInfo[],
		filePath: string,
	): void {
		const tagName = this.extractTagName(node)
		if (!tagName) return

		const symbolId = this.generateSymbolId(tagName, filePath, node.startPosition.row)
		const metadata = this.extractMetadata(node, content)

		// Extract XML attributes
		this.extractXmlAttributes(node, content, metadata)

		// Special handling for Odoo records
		if (tagName === "record") {
			this.extractOdooRecord(node, content, metadata, relationships, filePath)
		}

		const symbol: SymbolInfo = {
			id: symbolId,
			name: tagName,
			type: this.determineSymbolType(tagName, metadata),
			filePath,
			startLine: node.startPosition.row,
			endLine: node.endPosition.row,
			metadata,
		}

		symbols.push(symbol)

		// Extract parent-child relationships
		this.extractElementRelationships(node, symbolId, relationships, filePath)
	}

	private extractXmlAttributes(node: Node, content: string, metadata: Record<string, any>): void {
		const attributeNode = node.childForFieldName("attribute")
		if (attributeNode) {
			for (let i = 0; i < attributeNode.childCount; i++) {
				const attr = attributeNode.child(i)
				if (attr && attr.type === "attribute") {
					const attrName = this.extractAttributeName(attr)
					const attrValue = this.extractAttributeValue(attr, content)
					if (attrName && attrValue) {
						metadata.attributes = metadata.attributes || {}
						metadata.attributes[attrName] = attrValue
					}
				}
			}
		}
	}

	private extractOdooRecord(
		node: Node,
		content: string,
		metadata: Record<string, any>,
		relationships: RelationshipInfo[],
		filePath: string,
	): void {
		const attributes = metadata.attributes || {}

		if (attributes.model) {
			metadata.odooModel = attributes.model
			metadata.odooId = attributes.id

			// Create relationship to the corresponding Python class
			if (attributes.model) {
				const modelSymbolId = this.generateSymbolId(attributes.model, "", 0) // Will be resolved later
				const recordSymbolId = this.generateSymbolId(
					`record:${attributes.id}`,
					filePath,
					node.startPosition.row,
				)

				const relationship: RelationshipInfo = {
					id: this.generateRelationshipId(recordSymbolId, modelSymbolId, "REFERENCES"),
					fromSymbolId: recordSymbolId,
					toSymbolId: modelSymbolId,
					type: "REFERENCES",
					metadata: {
						referenceType: "odoo_record_to_model",
						model: attributes.model,
						recordId: attributes.id,
					},
				}

				relationships.push(relationship)
			}
		}
	}

	private extractElementRelationships(
		node: Node,
		symbolId: string,
		relationships: RelationshipInfo[],
		filePath: string,
	): void {
		// Find parent element
		const parentElement = this.findParentElement(node)
		if (parentElement) {
			const parentTagName = this.extractTagName(parentElement)
			if (parentTagName) {
				const parentSymbolId = this.generateSymbolId(parentTagName, filePath, parentElement.startPosition.row)

				const relationship: RelationshipInfo = {
					id: this.generateRelationshipId(symbolId, parentSymbolId, "REFERENCES"),
					fromSymbolId: symbolId,
					toSymbolId: parentSymbolId,
					type: "REFERENCES",
					metadata: { relationshipType: "xml_parent_child" },
				}

				relationships.push(relationship)
			}
		}
	}

	private traverseForDependencies(node: Node, content: string, dependencies: string[]): void {
		if (node.type === "element") {
			const tagName = this.extractTagName(node)
			if (tagName) {
				const metadata: Record<string, any> = {}
				this.extractXmlAttributes(node, content, metadata)

				// Add external dependencies
				if (metadata.attributes) {
					for (const [key, value] of Object.entries(metadata.attributes)) {
						if (typeof value === "string" && (value.includes(".") || value.includes("/"))) {
							dependencies.push(`${key}=${value}`)
						}
					}
				}
			}
		}

		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child) {
				this.traverseForDependencies(child, content, dependencies)
			}
		}
	}

	private extractTagName(node: Node): string | null {
		const tagNode = node.childForFieldName("tag")
		if (tagNode && tagNode.type === "tag_name") {
			return this.getNodeText(tagNode, "")
		}
		return null
	}

	private extractAttributeName(node: Node): string | null {
		const nameNode = node.childForFieldName("name")
		if (nameNode && nameNode.type === "attribute_name") {
			return this.getNodeText(nameNode, "")
		}
		return null
	}

	private extractAttributeValue(node: Node, content: string): string | null {
		const valueNode = node.childForFieldName("value")
		if (valueNode) {
			return this.getNodeText(valueNode, content).replace(/['"]/g, "")
		}
		return null
	}

	private findParentElement(node: Node): Node | null {
		let current: Node | null = node.parent
		while (current) {
			if (current.type === "element") {
				return current
			}
			current = current.parent
		}
		return null
	}

	private determineSymbolType(
		tagName: string,
		metadata: Record<string, any>,
	): "class" | "function" | "method" | "variable" | "import" {
		// Determine symbol type based on XML tag and attributes
		if (tagName === "record") {
			return "class" // Odoo records represent model instances
		}
		if (tagName === "template" || tagName === "view") {
			return "function" // Views are like functions that render
		}
		if (tagName === "field") {
			return "variable"
		}
		if (tagName === "button" || tagName === "menuitem") {
			return "method" // Actions that can be called
		}

		return "variable" // Default for other XML elements
	}

	private generateContext(symbol: SymbolInfo, children: SymbolInfo[]): string {
		const context = [`${symbol.type} ${symbol.name}`]

		if (children.length > 0) {
			context.push(`Contains: ${children.map((c) => c.name).join(", ")}`)
		}

		if (symbol.metadata.odooModel) {
			context.push(`Odoo Model: ${symbol.metadata.odooModel}`)
		}

		if (symbol.metadata.odooId) {
			context.push(`Record ID: ${symbol.metadata.odooId}`)
		}

		if (symbol.metadata.attributes) {
			const attrs = Object.entries(symbol.metadata.attributes)
				.map(([key, value]) => `${key}=${value}`)
				.join(", ")
			context.push(`Attributes: ${attrs}`)
		}

		return context.join(" | ")
	}
}
