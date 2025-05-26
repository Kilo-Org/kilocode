import * as jscodeshift from "jscodeshift"
import { Collection } from "jscodeshift"
import { AstSelector, CodeSelector, isAstSelector, isIdentifierSelector, isLocationSelector } from "../dsl/types"
import { loadRequiredLanguageParsers } from "../../tree-sitter/languageParser"
import * as fs from "fs/promises"
import * as path from "path"

/**
 * Check if a node is fully contained within the specified line range.
 *
 * @param node The AST node to check
 * @param startLine The 1-based starting line number of the range
 * @param endLine The 1-based ending line number of the range
 * @returns True if the node is fully contained within the range, false otherwise.
 */
export function isNodeInRange(node: any, startLine: number, endLine: number): boolean {
	if (!node || !node.loc) {
		// console.log(`Node missing location info: ${node ? node.type : 'undefined'}`); // Keep for debugging if needed
		return false
	}

	// All numbers are 1-based
	const nodeStartLine = node.loc.start.line
	const nodeEndLine = node.loc.end.line

	// Debug info (optional, can be removed later)
	// console.log(`Checking node ${node.type} at lines ${nodeStartLine}-${nodeEndLine} against range ${startLine}-${endLine}`);

	// A node is in range only if it is fully contained within the specified range.
	const isFullyContained = nodeStartLine >= startLine && nodeEndLine <= endLine

	// The previous logic included overlap, but the requirement is strict containment.
	// Removing overlap calculation and check.

	// console.log(`Node ${node.type} is in range: ${isFullyContained}`); // Keep for debugging if needed

	return isFullyContained
}

/**
 * Determine if a node is nested inside another node
 *
 * @param node The potentially nested node
 * @param container The potential container node
 * @returns True if the node is nested inside the container
 */
export function isNodeNestedIn(node: any, container: any): boolean {
	if (!node.loc || !container.loc) return false

	return (
		node.loc.start.line >= container.loc.start.line &&
		node.loc.end.line <= container.loc.end.line &&
		// Ensure we don't match the node with itself
		!(
			node.loc.start.line === container.loc.start.line &&
			node.loc.end.line === container.loc.end.line &&
			node.loc.start.column === container.loc.start.column &&
			node.loc.end.column === container.loc.end.column
		)
	)
}

/**
 * Extract function declarations that are nested inside a node
 * Uses an iterative approach to prevent stack overflow
 *
 * @param node The parent node
 * @returns Array of nested function nodes found
 */
export function extractNestedFunctions(node: any): any[] {
	const nestedFunctions: any[] = []

	// Skip if node is invalid
	if (!node || typeof node !== "object") {
		return nestedFunctions
	}

	// Use an explicit stack instead of recursion
	const stack: any[] = [node]
	// Track visited nodes to prevent cycles
	const visited = new WeakSet()

	while (stack.length > 0) {
		const currentNode = stack.pop()

		// Skip if null, not an object, or already visited
		if (!currentNode || typeof currentNode !== "object" || visited.has(currentNode)) {
			continue
		}

		// Mark as visited to avoid circular references
		visited.add(currentNode)

		// Check if this is a function declaration or a variable declaration with a function initializer
		if (currentNode.type === "FunctionDeclaration") {
			// Handle FunctionDeclarations
			if (currentNode.id?.name) {
				nestedFunctions.push(currentNode)
			}
		} else if (currentNode.type === "VariableDeclaration") {
			// Handle VariableDeclarations with function initializers
			const declaration = currentNode.declarations?.[0]
			if (
				declaration &&
				(declaration.init?.type === "FunctionExpression" ||
					declaration.init?.type === "ArrowFunctionExpression")
			) {
				const functionNode = declaration.init
				// For FunctionExpressions, the name is on the function node's id
				// For ArrowFunctionExpressions, the name is on the variable declarator's id
				const functionName =
					functionNode.type === "FunctionExpression" ? functionNode.id?.name : declaration.id?.name

				if (functionName) {
					// Create a simplified representation for the nested function
					const extractedFunction = {
						type: functionNode.type,
						id: { name: functionName },
						loc: functionNode.loc,
						comments: functionNode.comments,
						// Add other properties if needed for context or later processing
					}
					nestedFunctions.push(extractedFunction)
				}
			}
		} else if (
			(currentNode.type === "FunctionExpression" || currentNode.type === "ArrowFunctionExpression") &&
			currentNode.id?.name
		) {
			// Handle standalone named FunctionExpressions or ArrowFunctionExpressions (less common but possible)
			nestedFunctions.push(currentNode)
		}

		// Add all properties to the stack
		for (const key in currentNode) {
			if (currentNode.hasOwnProperty(key) && key !== "loc" && key !== "range" && key !== "comments") {
				const child = currentNode[key]

				if (Array.isArray(child)) {
					// Add array items to stack in reverse to maintain traversal order
					for (let i = child.length - 1; i >= 0; i--) {
						stack.push(child[i])
					}
				} else if (child && typeof child === "object") {
					stack.push(child)
				}
			}
		}
	}

	return nestedFunctions
}

/**
 * Select top-level nodes from an AST that fall within a specified line range
 *
 * @param ast The jscodeshift Collection containing the AST
 * @param startLine The 1-based starting line number
 * @param endLine The 1-based ending line number
 * @returns An object containing the nodes to move and their paths for removal
 */
export function selectNodesInRange(
	ast: Collection<any>,
	startLine: number,
	endLine: number,
): { nodesToMove: any[]; nodesToRemove: any[]; nestedFunctions: any[] } {
	const nodesToMove: any[] = []
	const nodesToRemove: any[] = []
	const nestedFunctions: any[] = []
	const j = jscodeshift

	try {
		// Get the program body (all top-level nodes)
		const programPath = ast.find(j.Program).get()
		if (!programPath || !programPath.node || !programPath.node.body) {
			console.warn("Could not find program body")
			return { nodesToMove, nodesToRemove, nestedFunctions }
		}

		// Get the program body
		const programBody = programPath.node.body

		// Process only top-level nodes - use a simpler approach
		for (let i = 0; i < programBody.length; i++) {
			const node = programBody[i]

			// Skip nodes without location info
			if (!node.loc) continue

			// Get node line range (1-based)
			const nodeStartLine = node.loc.start.line
			const nodeEndLine = node.loc.end.line

			// Debug line numbering
			console.log(`Node at line ${nodeStartLine}-${nodeEndLine}, Target range: ${startLine}-${endLine}`)

			// Check if the node is fully contained within the target range.
			// A node is considered in range only if it starts and ends within the specified range.
			const isFullyContained = nodeStartLine >= startLine && nodeEndLine <= endLine

			// The previous logic included overlap, but the requirement is strict containment.
			// Removing overlap calculation and check.

			if (isFullyContained) {
				console.log(`Node ${node.type} is fully contained in range`)

				// Add to nodes to move
				nodesToMove.push(node)

				// Find the path to this node for removal
				let pathToRemove = null
				ast.find(j.Node, (n) => n === node).forEach((path) => {
					pathToRemove = path
				})

				// Add to nodes to remove if we found the path
				if (pathToRemove) {
					nodesToRemove.push(pathToRemove)
				}

				// Only extract nested functions for function declarations to avoid recursion issues
				if (node.type === "FunctionDeclaration") {
					try {
						// Get function declarations in nested scopes, but limit recursion
						const body = node.body
						if (body && body.type === "BlockStatement" && body.body) {
							// Look for function declarations directly in the body
							for (const stmt of body.body) {
								if (stmt.type === "FunctionDeclaration" && stmt.id && stmt.id.name) {
									nestedFunctions.push(stmt)
								}
							}
						}
					} catch (err) {
						console.warn(`Error finding nested functions: ${err}`)
					}
				}
			}
		}
	} catch (err) {
		console.error(`Error in selectNodesInRange: ${err}`)
	}

	return { nodesToMove, nodesToRemove, nestedFunctions }
}

/**
 * Node types for common code structures that can be targeted for refactoring
 */
export enum CodeStructureType {
	Function = "function",
	Class = "class",
	Method = "method",
	Interface = "interface",
	Type = "type",
	Variable = "variable",
	Import = "import",
	Export = "export",
}

/**
 * Interface representing a code structure node with context information
 */
export interface CodeStructureNode<T = any> {
	/** The node from the AST */
	node: T
	/** Type of code structure */
	type: CodeStructureType
	/** Name of the code structure, if applicable */
	name?: string
	/** Range in the source code (1-based) */
	range: {
		startLine: number
		endLine: number
		startColumn: number
		endColumn: number
	}
	/** Parent structure that contains this node, if any */
	parent?: CodeStructureNode
	/** Child structures contained within this node, if any */
	children?: CodeStructureNode[]
	/** Additional metadata about the node */
	metadata?: Record<string, unknown>
}

/**
 * Options for selecting AST nodes
 */
export interface NodeSelectionOptions {
	/** Include nested nodes in the selection */
	includeNested?: boolean
	/** Include only nodes of specific types */
	nodeTypes?: string[]
	/** Maximum depth for nested node traversal */
	maxDepth?: number
	/** Whether to include comments associated with nodes */
	includeComments?: boolean
}

/**
 * Create a Tree-sitter query for selecting nodes based on type and constraints
 *
 * @param nodeType The type of node to select (e.g., "function_declaration", "class_declaration")
 * @param constraints Additional constraints to narrow down the selection
 * @returns A query string that can be used with Tree-sitter
 */
export function createTreeSitterQuery(nodeType: string, constraints: Record<string, string> = {}): string {
	let query = `(${nodeType}`

	// Add named captures for the node
	query += ` @node`

	// Add constraints as predicates
	const predicates = Object.entries(constraints)
		.map(([key, value]) => `#eq? @node.${key} "${value}"`)
		.join(" ")

	if (predicates) {
		query += ` (#${predicates})`
	}

	query += ")"

	return query
}

/**
 * Context-aware node selection based on scope and relationships
 *
 * @param ast The AST collection to analyze
 * @param selector The code selector to use for targeting nodes
 * @param options Additional options for selection
 * @returns Array of selected nodes with context information
 */
export async function selectNodesWithContext(
	ast: Collection<any>,
	selector: CodeSelector,
	options: NodeSelectionOptions = {},
): Promise<CodeStructureNode[]> {
	const j = jscodeshift
	const result: CodeStructureNode[] = []

	// Handle different selector types
	if (isLocationSelector(selector)) {
		// For location selectors, find all nodes in the range
		const { nodesToMove } = selectNodesInRange(ast, selector.startLine, selector.endLine)

		// Convert to CodeStructureNode format
		for (const node of nodesToMove) {
			result.push(createCodeStructureNodeFromJscodeshiftNode(node))
		}
	} else if (isIdentifierSelector(selector)) {
		// For identifier selectors, find nodes by name
		const { name, kind } = selector

		// Map kind to jscodeshift node types
		const nodeTypes = mapKindToNodeTypes(kind)

		// Find nodes matching the name and types
		ast.find(j.Node).forEach((path) => {
			if (isNodeMatchingIdentifier(path.node, name, nodeTypes)) {
				result.push(createCodeStructureNodeFromJscodeshiftNode(path.node))
			}
		})
	} else if (isAstSelector(selector)) {
		// For AST selectors, use tree-sitter for more precise queries
		const treeNodes = await selectNodesWithTreeSitter(selector)
		result.push(...treeNodes)
	}

	// If requested, process nested nodes
	if (options.includeNested) {
		processNestedNodes(result)
	}

	return result
}

/**
 * Select nodes using Tree-sitter based on an AST selector
 *
 * @param selector The AST selector definition
 * @returns Array of selected nodes with context information
 */
export async function selectNodesWithTreeSitter(selector: AstSelector): Promise<CodeStructureNode[]> {
	const result: CodeStructureNode[] = []
	const { filePath, nodeType, constraints } = selector

	try {
		// Read file content
		const fileContent = await fs.readFile(filePath, "utf8")
		const ext = path.extname(filePath).slice(1)

		// Load appropriate language parser
		const languageParsers = await loadRequiredLanguageParsers([filePath])
		const { parser } = languageParsers[ext] || {}

		if (!parser) {
			throw new Error(`No parser available for ${ext} files`)
		}

		// Parse the file
		const tree = parser.parse(fileContent)

		// Instead of using tree-sitter Query directly, use the custom query method
		// that's implemented in the languageParser
		const captures = []

		// Use an adapted query approach based on node types
		if (tree.rootNode) {
			// For each node in the AST, check if it matches our criteria
			const nodesToProcess = [tree.rootNode]

			while (nodesToProcess.length > 0) {
				const currentNode = nodesToProcess.pop()

				if (!currentNode) continue

				// Check if this node's type matches what we're looking for
				if (currentNode.type === mapJSNodeTypeToTreeSitter(nodeType)) {
					// Check position constraints if specified
					let positionMatches = true
					if (constraints?.position) {
						const { startLine, endLine } = constraints.position
						// Tree-sitter uses 0-based indices, convert to 1-based for comparison
						const nodeStart = currentNode.startPosition.row + 1
						const nodeEnd = currentNode.endPosition.row + 1

						if (nodeStart < startLine || nodeEnd > endLine) {
							positionMatches = false
						}
					}

					// Check content constraint if specified
					let contentMatches = true
					if (constraints?.content) {
						const nodeText = currentNode.text
						if (!nodeText.includes(constraints.content)) {
							contentMatches = false
						}
					}

					// Check property constraints
					let propertiesMatch = true
					if (constraints?.properties && Object.keys(constraints.properties).length > 0) {
						// This is more complex as we'd need to traverse the AST structure
						// For now, we'll only do basic matching based on node.text
						const nodeText = currentNode.text
						for (const [_key, value] of Object.entries(constraints.properties)) {
							const stringValue = String(value)
							if (!nodeText.includes(stringValue)) {
								propertiesMatch = false
								break
							}
						}
					}

					// If all constraints match, add to captures
					if (positionMatches && contentMatches && propertiesMatch) {
						captures.push({
							node: currentNode,
							name: "node",
						})
					}
				}

				// Add all children to the processing queue
				for (let i = 0; i < currentNode.childCount; i++) {
					const child = currentNode.child(i)
					if (child) {
						nodesToProcess.push(child)
					}
				}
			}
		}

		// Process captures
		for (const capture of captures) {
			const node = capture.node
			result.push(createCodeStructureNodeFromTreeSitterNode(node))
		}
	} catch (error) {
		console.error(`Error selecting nodes with Tree-sitter: ${error}`)
	}

	return result
}

/**
 * Identify specific code structures (functions, classes, etc.) in the AST
 *
 * @param ast The AST collection to analyze
 * @param type The type of code structure to find
 * @param options Additional options for identification
 * @returns Array of identified code structure nodes
 */
export function identifyCodeStructures(
	ast: Collection<any>,
	type: CodeStructureType,
	options: NodeSelectionOptions = {},
): CodeStructureNode[] {
	const j = jscodeshift
	const result: CodeStructureNode[] = []

	// Map the code structure type to jscodeshift node types
	const nodeTypes = getNodeTypesForCodeStructure(type)

	// Find all nodes of the specified types
	for (const nodeType of nodeTypes) {
		// Get appropriate finder for this node type
		let finder

		// Use a type-safe approach to determine the appropriate finder
		switch (nodeType) {
			case "FunctionDeclaration":
				finder = j.FunctionDeclaration
				break
			case "ClassDeclaration":
				finder = j.ClassDeclaration
				break
			case "VariableDeclaration":
				finder = j.VariableDeclaration
				break
			case "ImportDeclaration":
				finder = j.ImportDeclaration
				break
			case "ExportNamedDeclaration":
				finder = j.ExportNamedDeclaration
				break
			case "ExportDefaultDeclaration":
				finder = j.ExportDefaultDeclaration
				break
			case "InterfaceDeclaration":
			case "TSInterfaceDeclaration":
				finder = j.TSInterfaceDeclaration
				break
			case "TypeAlias":
			case "TSTypeAliasDeclaration":
				finder = j.TSTypeAliasDeclaration
				break
			default:
				finder = j.Node
				break
		}
		ast.find(finder).forEach((path) => {
			const node = path.node

			// Skip nodes that don't match specified types if provided
			if (options.nodeTypes && !options.nodeTypes.includes(nodeType)) {
				return
			}

			// Create a code structure node
			const structureNode = createCodeStructureNodeFromJscodeshiftNode(node, type)
			result.push(structureNode)

			// Process nested structures if requested
			if (options.includeNested) {
				structureNode.children = findNestedStructures(node, options.maxDepth || 3)
			}
		})
	}

	return result
}

/**
 * Validate selected nodes before performing transformations
 *
 * @param nodes The nodes to validate
 * @param rules Validation rules to apply
 * @returns Validation result with success status and any issues
 */
export function validateNodeSelection(nodes: CodeStructureNode[], rules: ValidationRule[]): ValidationResult {
	const result: ValidationResult = {
		isValid: true,
		issues: [],
	}

	// Apply each validation rule to the nodes
	for (const rule of rules) {
		for (const node of nodes) {
			const issue = rule.validate(node)
			if (issue) {
				result.isValid = false
				result.issues.push(issue)
			}
		}
	}

	return result
}

/**
 * Interface for validation rules that can be applied to nodes
 */
export interface ValidationRule {
	/** Name of the validation rule */
	name: string
	/** Function to validate a node, returns an issue description if invalid */
	validate: (node: CodeStructureNode) => string | null
}

/**
 * Result of validating selected nodes
 */
export interface ValidationResult {
	/** Whether all nodes pass validation */
	isValid: boolean
	/** List of issues found during validation */
	issues: string[]
}

/**
 * Common validation rules for node selection
 */
export const CommonValidationRules = {
	/**
	 * Validates that nodes have valid location information
	 */
	hasValidLocation: {
		name: "hasValidLocation",
		validate: (node: CodeStructureNode): string | null => {
			if (
				!node.range ||
				!node.range.startLine ||
				!node.range.endLine ||
				node.range.startLine > node.range.endLine
			) {
				return `Node ${node.name || node.type} has invalid location information`
			}
			return null
		},
	},

	/**
	 * Validates that function nodes have a body
	 */
	functionHasBody: {
		name: "functionHasBody",
		validate: (node: CodeStructureNode): string | null => {
			if (node.type === CodeStructureType.Function || node.type === CodeStructureType.Method) {
				const jsNode = node.node
				if (!jsNode.body || (jsNode.body.type === "BlockStatement" && jsNode.body.body.length === 0)) {
					return `Function ${node.name || "unnamed"} has an empty body`
				}
			}
			return null
		},
	},

	/**
	 * Validates that class nodes have at least one method or property
	 */
	classHasMembers: {
		name: "classHasMembers",
		validate: (node: CodeStructureNode): string | null => {
			if (node.type === CodeStructureType.Class) {
				const jsNode = node.node
				if (!jsNode.body || !jsNode.body.body || jsNode.body.body.length === 0) {
					return `Class ${node.name || "unnamed"} has no members`
				}
			}
			return null
		},
	},
}

// ===== Helper functions =====

/**
 * Map kind from IdentifierSelector to jscodeshift node types
 */
function mapKindToNodeTypes(kind?: string): string[] {
	switch (kind) {
		case "function":
			return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]
		case "variable":
			return ["VariableDeclaration", "VariableDeclarator"]
		case "class":
			return ["ClassDeclaration", "ClassExpression"]
		case "method":
			return ["MethodDefinition"]
		case "property":
			return ["PropertyDefinition", "Property"]
		case "parameter":
			return ["Identifier"] // Will need additional checks
		case "import":
			return ["ImportDeclaration"]
		default:
			return [] // Empty array means all types
	}
}

/**
 * Check if a node matches an identifier name and type
 */
function isNodeMatchingIdentifier(node: any, name: string, nodeTypes: string[]): boolean {
	// Skip nodes that don't match the required type
	if (nodeTypes.length > 0 && !nodeTypes.includes(node.type)) {
		return false
	}

	// Check for name match based on node type
	if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration" || node.type === "MethodDefinition") {
		return node.id?.name === name
	} else if (node.type === "VariableDeclarator") {
		return node.id?.name === name
	} else if (node.type === "VariableDeclaration") {
		// For variable declarations, check if any of the declarators match the name
		return Array.isArray(node.declarations) && node.declarations.some((decl: any) => decl.id?.name === name)
	} else if (node.type === "Property" || node.type === "PropertyDefinition") {
		return node.key?.name === name
	} else if (node.type === "Identifier") {
		return node.name === name
	} else if (node.type === "ImportDeclaration") {
		return node.specifiers?.some((spec: any) => spec.local?.name === name)
	}

	return false
}

/**
 * Create a CodeStructureNode from a jscodeshift node
 */
function createCodeStructureNodeFromJscodeshiftNode(node: any, type?: CodeStructureType): CodeStructureNode {
	// Determine node type if not provided
	const nodeType = type || inferCodeStructureType(node)

	// Extract node name based on its type
	const nodeName = extractNodeName(node)

	return {
		node,
		type: nodeType,
		name: nodeName,
		range: {
			startLine: node.loc?.start.line || 0,
			endLine: node.loc?.end.line || 0,
			startColumn: node.loc?.start.column || 0,
			endColumn: node.loc?.end.column || 0,
		},
		children: [],
	}
}

/**
 * Create a CodeStructureNode from a tree-sitter node
 */
function createCodeStructureNodeFromTreeSitterNode(node: any): CodeStructureNode {
	// Determine node type based on tree-sitter node type
	const nodeType = inferCodeStructureTypeFromTreeSitterNode(node)

	// Extract node name if possible
	const nodeName = extractNodeNameFromTreeSitterNode(node)

	return {
		node,
		type: nodeType,
		name: nodeName,
		range: {
			// Tree-sitter uses 0-based indices, convert to 1-based for consistency
			startLine: node.startPosition.row + 1,
			endLine: node.endPosition.row + 1,
			startColumn: node.startPosition.column + 1,
			endColumn: node.endPosition.column + 1,
		},
		children: [],
	}
}

/**
 * Map jscodeshift node type to tree-sitter query node type
 */
function mapJSNodeTypeToTreeSitter(nodeType: string): string {
	// Map between jscodeshift AST node types and tree-sitter query node types
	const typeMap: Record<string, string> = {
		FunctionDeclaration: "function_declaration",
		ClassDeclaration: "class_declaration",
		InterfaceDeclaration: "interface_declaration",
		VariableDeclaration: "variable_declaration",
		MethodDefinition: "method_definition",
		ImportDeclaration: "import_declaration",
		ExportNamedDeclaration: "export_statement",
		TypeAlias: "type_alias",
		TSTypeAliasDeclaration: "type_alias_declaration",
		TSInterfaceDeclaration: "interface_declaration",
	}

	return typeMap[nodeType] || nodeType.toLowerCase()
}

/**
 * Infer the code structure type from a node
 */
function inferCodeStructureType(node: any): CodeStructureType {
	if (!node || !node.type) {
		return CodeStructureType.Variable // Default
	}

	switch (node.type) {
		case "FunctionDeclaration":
		case "FunctionExpression":
		case "ArrowFunctionExpression":
			return CodeStructureType.Function

		case "ClassDeclaration":
		case "ClassExpression":
			return CodeStructureType.Class

		case "MethodDefinition":
			return CodeStructureType.Method

		case "InterfaceDeclaration":
		case "TSInterfaceDeclaration":
			return CodeStructureType.Interface

		case "TypeAlias":
		case "TSTypeAliasDeclaration":
			return CodeStructureType.Type

		case "VariableDeclaration":
		case "VariableDeclarator":
			return CodeStructureType.Variable

		case "ImportDeclaration":
			return CodeStructureType.Import

		case "ExportNamedDeclaration":
		case "ExportDefaultDeclaration":
			return CodeStructureType.Export

		default:
			return CodeStructureType.Variable
	}
}

/**
 * Infer code structure type from a tree-sitter node
 */
function inferCodeStructureTypeFromTreeSitterNode(node: any): CodeStructureType {
	const type = node.type

	if (type.includes("function") || type === "arrow_function") {
		return CodeStructureType.Function
	}

	if (type.includes("class")) {
		return CodeStructureType.Class
	}

	if (type.includes("method")) {
		return CodeStructureType.Method
	}

	if (type.includes("interface")) {
		return CodeStructureType.Interface
	}

	if (type.includes("type_alias") || type.includes("type_declaration")) {
		return CodeStructureType.Type
	}

	if (type.includes("variable") || type.includes("const_declaration")) {
		return CodeStructureType.Variable
	}

	if (type.includes("import")) {
		return CodeStructureType.Import
	}

	if (type.includes("export")) {
		return CodeStructureType.Export
	}

	return CodeStructureType.Variable
}

/**
 * Extract the name of a node based on its type
 */
function extractNodeName(node: any): string | undefined {
	if (!node) return undefined

	switch (node.type) {
		case "FunctionDeclaration":
		case "ClassDeclaration":
			return node.id?.name

		case "MethodDefinition":
			return node.key?.name || (node.key?.value ? String(node.key.value) : undefined)

		case "VariableDeclaration":
			// For VariableDeclaration, extract the name from the first declarator
			if (node.declarations && node.declarations.length > 0 && node.declarations[0].id) {
				return node.declarations[0].id.name
			}
			return undefined

		case "VariableDeclarator":
			return node.id?.name

		case "Property":
		case "PropertyDefinition":
			return node.key?.name || (node.key?.value ? String(node.key.value) : undefined)

		case "InterfaceDeclaration":
		case "TSInterfaceDeclaration":
			return node.id?.name

		case "TypeAlias":
		case "TSTypeAliasDeclaration":
			return node.id?.name

		default:
			return undefined
	}
}

/**
 * Extract node name from a tree-sitter node
 */
function extractNodeNameFromTreeSitterNode(node: any): string | undefined {
	// Try to find a name property or identifier
	for (let i = 0; i < node.namedChildCount; i++) {
		const child = node.namedChild(i)

		// Check if this child is an identifier
		if (child.type === "identifier" || child.type.includes("name")) {
			return child.text
		}
	}

	return undefined
}

/**
 * Find nested code structures within a node
 */
function findNestedStructures(node: any, maxDepth: number = 3, currentDepth: number = 0): CodeStructureNode[] {
	if (currentDepth >= maxDepth || !node) {
		return []
	}

	const nestedStructures: CodeStructureNode[] = []

	// Helper to process a node and add it if it's a significant code structure
	const processNode = (childNode: any) => {
		if (!childNode || typeof childNode !== "object") {
			return
		}

		// Check if this is a significant node type
		if (isSignificantNode(childNode)) {
			const childStructure = createCodeStructureNodeFromJscodeshiftNode(childNode)
			nestedStructures.push(childStructure)

			// Recursively find nested structures in this child
			childStructure.children = findNestedStructures(childNode, maxDepth, currentDepth + 1)
			return
		}

		// If it's not a significant node, recursively check its properties
		for (const key in childNode) {
			if (childNode.hasOwnProperty(key) && key !== "loc" && key !== "range" && key !== "comments") {
				const value = childNode[key]

				if (Array.isArray(value)) {
					value.forEach(processNode)
				} else if (value && typeof value === "object") {
					processNode(value)
				}
			}
		}
	}

	processNode(node)
	return nestedStructures
}

/**
 * Check if a node is a significant code structure
 */
function isSignificantNode(node: any): boolean {
	if (!node || !node.type) {
		return false
	}

	const significantTypes = [
		"FunctionDeclaration",
		"FunctionExpression",
		"ArrowFunctionExpression",
		"ClassDeclaration",
		"ClassExpression",
		"MethodDefinition",
		"InterfaceDeclaration",
		"TSInterfaceDeclaration",
		"TypeAlias",
		"TSTypeAliasDeclaration",
		"VariableDeclaration",
	]

	return significantTypes.includes(node.type)
}

/**
 * Process nested nodes to build the parent-child relationships
 */
function processNestedNodes(nodes: CodeStructureNode[]): void {
	// Build a map of nodes by their line range for quick lookup
	const nodesByRange = new Map<string, CodeStructureNode>()

	for (const node of nodes) {
		const key = `${node.range.startLine}-${node.range.endLine}`
		nodesByRange.set(key, node)
	}

	// Find parent-child relationships
	for (const node of nodes) {
		// Find children by checking if they're contained within this node's range
		for (const potentialChild of nodes) {
			// Skip comparing a node to itself
			if (node === potentialChild) {
				continue
			}

			// Check if the potential child is contained within this node
			if (
				potentialChild.range.startLine >= node.range.startLine &&
				potentialChild.range.endLine <= node.range.endLine
			) {
				// Initialize children array if needed
				node.children = node.children || []

				// Add the child if it's not already added
				if (!node.children.includes(potentialChild)) {
					node.children.push(potentialChild)
				}

				// Set the parent reference
				potentialChild.parent = node
			}
		}
	}
}

/**
 * Get jscodeshift node types for a given code structure type
 */
function getNodeTypesForCodeStructure(type: CodeStructureType): string[] {
	switch (type) {
		case CodeStructureType.Function:
			return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]
		case CodeStructureType.Class:
			return ["ClassDeclaration", "ClassExpression"]
		case CodeStructureType.Method:
			return ["MethodDefinition"]
		case CodeStructureType.Interface:
			return ["InterfaceDeclaration", "TSInterfaceDeclaration"]
		case CodeStructureType.Type:
			return ["TypeAlias", "TSTypeAliasDeclaration"]
		case CodeStructureType.Variable:
			return ["VariableDeclaration"]
		case CodeStructureType.Import:
			return ["ImportDeclaration"]
		case CodeStructureType.Export:
			return ["ExportNamedDeclaration", "ExportDefaultDeclaration"]
		default:
			return []
	}
}
