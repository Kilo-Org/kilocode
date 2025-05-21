import * as vscode from "vscode"
import type Parser from "web-tree-sitter"
import * as URI from "uri-js"

import { AutocompleteLanguageInfo } from "../AutocompleteLanguageInfo" // Assuming this is our equivalent
import {
	// Range, // Unused import
	RangeInFile,
	RangeInFileWithContents,
	// AutocompleteCodeSnippet, // We'll use RangeInFileWithContents
	// AutocompleteSnippetType, // We'll assume 'Code' type for now
} from "../ide-types"
import { IDE } from "./ide" // Assuming IDE interface is in utils/ide
import { getAst, getTreePathAtCursor } from "./ast" // Assuming these exist and are compatible

// Constants from continue/core/indexing/chunk/code
// These might need to be adjusted based on our tree-sitter queries or AST structure
const FUNCTION_BLOCK_NODE_TYPES = [
	"block", // JavaScript, TypeScript, C++, Java
	"statement_block", // Python
	"compound_statement", // C, C#
	// Add more as needed for other languages
]

const FUNCTION_DECLARATION_NODE_TYPES = [
	"function_declaration", // JavaScript, TypeScript
	"function_definition", // C, C++, Python
	"method_declaration", // Java, C#
	// Add more as needed for other languages
]

type GotoProviderName =
	| "vscode.executeDefinitionProvider"
	| "vscode.executeTypeDefinitionProvider"
	| "vscode.executeDeclarationProvider"
	| "vscode.executeImplementationProvider"
	| "vscode.executeReferenceProvider"

interface GotoInput {
	uri: vscode.Uri
	line: number
	character: number
	name: GotoProviderName
}
function gotoInputKey(input: GotoInput): string {
	return `${input.name}${input.uri.toString()}${input.line}${input.character}`
}

const MAX_CACHE_SIZE = 500
const gotoCache = new Map<string, RangeInFile[]>()

export async function executeGotoProvider(input: GotoInput): Promise<RangeInFile[]> {
	const cacheKey = gotoInputKey(input)
	const cached = gotoCache.get(cacheKey)
	if (cached) {
		return cached
	}

	try {
		const definitions = (await vscode.commands.executeCommand(
			input.name,
			input.uri,
			new vscode.Position(input.line, input.character),
		)) as (vscode.Location | vscode.LocationLink)[] // More specific typing

		const mappedDefs = definitions.map((d) => {
			if ("targetUri" in d && "targetRange" in d) {
				// vscode.LocationLink
				return {
					filepath: d.targetUri.toString(),
					range: d.targetRange, // vscode.Range
				}
			} else if ("uri" in d && "range" in d) {
				// vscode.Location
				return {
					filepath: d.uri.toString(),
					range: d.range, // vscode.Range
				}
			}
			return null
		})

		const filteredDefs = mappedDefs.filter((r): r is { filepath: string; range: vscode.Range } => r !== null)

		const results: RangeInFile[] = filteredDefs.map((r) => ({
			// Convert vscode.Range to our Range type
			filepath: r.filepath,
			range: {
				start: { line: r.range.start.line, character: r.range.start.character },
				end: { line: r.range.end.line, character: r.range.end.character },
			},
		}))

		if (gotoCache.size >= MAX_CACHE_SIZE) {
			const oldestKey = gotoCache.keys().next().value
			if (oldestKey) {
				gotoCache.delete(oldestKey)
			}
		}
		gotoCache.set(cacheKey, results)

		return results
	} catch (e) {
		console.warn(`Error executing ${input.name}:`, e)
		return []
	}
}

function isRifWithContents(rif: RangeInFile | RangeInFileWithContents): rif is RangeInFileWithContents {
	return typeof (rif as RangeInFileWithContents).contents === "string"
}

function findChildren(
	node: Parser.SyntaxNode,
	predicate: (n: Parser.SyntaxNode) => boolean,
	firstN?: number,
): Parser.SyntaxNode[] {
	let matchingNodes: Parser.SyntaxNode[] = []

	if (firstN && firstN <= 0) {
		return []
	}

	if (predicate(node)) {
		matchingNodes.push(node)
	}

	for (const child of node.children) {
		if (firstN && matchingNodes.length >= firstN) {
			break
		}
		matchingNodes = matchingNodes.concat(
			findChildren(child, predicate, firstN ? firstN - matchingNodes.length : undefined),
		)
	}
	return firstN ? matchingNodes.slice(0, firstN) : matchingNodes
}

function findTypeIdentifiers(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
	return findChildren(
		node,
		(childNode) =>
			childNode.type === "type_identifier" || // Common for TypeScript, Java, etc.
			(childNode.type === "Identifier" && childNode.text[0].toUpperCase() === childNode.text[0]) || // Fallback for some languages
			(childNode.parent?.type === "ERROR" && // Handle parsing errors gracefully
				childNode.type === "identifier" &&
				childNode.text[0].toUpperCase() === childNode.text[0]),
	)
}

async function crawlTypes(
	rif: RangeInFile | RangeInFileWithContents,
	ide: IDE,
	depth: number = 1,
	results: RangeInFileWithContents[] = [],
	searchedLabels: Set<string> = new Set(), // Tracks "filepath:TypeIdentifierText"
): Promise<RangeInFileWithContents[]> {
	if (depth < 0) return results

	const contents = isRifWithContents(rif) ? rif.contents : await ide.readFile(rif.filepath)

	const ast = await getAst(rif.filepath, contents) // Assumes getAst can handle filepath and contents
	if (!ast) {
		return results
	}

	const identifierNodes = findTypeIdentifiers(ast.rootNode).filter((node) => {
		const key = `${rif.filepath}:${node.text}`
		if (searchedLabels.has(key)) return false
		searchedLabels.add(key)
		return true
	})

	const definitionsPromises = identifierNodes.map(async (node) => {
		const [typeDef] = await executeGotoProvider({
			uri: vscode.Uri.parse(rif.filepath), // Use vscode.Uri.parse for string filepaths
			line: rif.range.start.line + node.startPosition.row,
			character: rif.range.start.character + node.startPosition.column,
			name: "vscode.executeDefinitionProvider",
		})

		if (!typeDef) return null

		// Ensure definition is not the same as the starting point to avoid infinite loops on self-referential types
		if (
			typeDef.filepath === rif.filepath &&
			typeDef.range.start.line === rif.range.start.line &&
			typeDef.range.start.character === rif.range.start.character
		) {
			return null
		}

		const defContents = await ide.readRangeInFile(typeDef.filepath, typeDef.range)
		return { ...typeDef, contents: defContents }
	})

	const newDefinitions = (await Promise.all(definitionsPromises)).filter(
		(d): d is RangeInFileWithContents => d !== null,
	)

	for (const definition of newDefinitions) {
		const alreadyExists = results.some(
			(r) =>
				URI.equal(r.filepath, definition.filepath) && // Use URI.equal for path comparison
				r.range.start.line === definition.range.start.line &&
				r.range.start.character === definition.range.start.character &&
				r.range.end.line === definition.range.end.line &&
				r.range.end.character === definition.range.end.character,
		)
		if (!alreadyExists) {
			results.push(definition)
			// Recursively crawl, decrementing depth
			await crawlTypes(definition, ide, depth - 1, results, searchedLabels)
		}
	}

	return results
}

export async function getDefinitionsForNode(
	uriString: string, // Changed to string
	node: Parser.SyntaxNode,
	ide: IDE,
	lang: AutocompleteLanguageInfo,
): Promise<RangeInFileWithContents[]> {
	const ranges: RangeInFileWithContents[] = []
	const uri = vscode.Uri.parse(uriString)

	switch (node.type) {
		case "call_expression": {
			const [funDef] = await executeGotoProvider({
				uri,
				line: node.startPosition.row,
				character: node.startPosition.column,
				name: "vscode.executeDefinitionProvider",
			})
			if (!funDef) break

			let funcText = await ide.readRangeInFile(funDef.filepath, funDef.range)
			if (funcText.split("\n").length > 15) {
				// Truncation logic
				let truncated = false
				const funRootAst = await getAst(funDef.filepath, funcText)
				if (funRootAst) {
					const [funNode] = findChildren(
						funRootAst.rootNode,
						(n) => FUNCTION_DECLARATION_NODE_TYPES.includes(n.type),
						1,
					)
					if (funNode) {
						const [statementBlockNode] = findChildren(
							funNode,
							(n) => FUNCTION_BLOCK_NODE_TYPES.includes(n.type),
							1,
						)
						if (statementBlockNode) {
							funcText = funRootAst.rootNode.text.slice(0, statementBlockNode.startIndex).trim()
							truncated = true
						}
					}
				}
				if (!truncated) {
					funcText = funcText.split("\n")[0] + ` ${lang.singleLineComment || "//"} ...`
				}
			}
			const funDefWithContents = { ...funDef, contents: funcText }
			ranges.push(funDefWithContents)
			ranges.push(...(await crawlTypes(funDefWithContents, ide)))
			break
		}
		case "new_expression": {
			// For constructor calls like `new MyClass()`
			const classNameNode = node.children.find(
				(child) => child.type === "identifier" || child.type === "type_identifier",
			)
			if (!classNameNode) break

			const [classDef] = await executeGotoProvider({
				uri,
				line: classNameNode.endPosition.row,
				character: classNameNode.endPosition.column,
				name: "vscode.executeDefinitionProvider",
			})
			if (!classDef) break

			const contents = await ide.readRangeInFile(classDef.filepath, classDef.range)
			const classDefWithContents = {
				...classDef,
				contents: `${lang.singleLineComment || "//"} ${classNameNode.text}:\n${contents.trim()}`,
			}
			ranges.push(classDefWithContents)
			ranges.push(...(await crawlTypes(classDefWithContents, ide)))
			break
		}
		// Add more cases as needed, e.g., for variable declarations, type usages, etc.
	}
	return ranges
}

export type GetLspDefinitionsFunction = (
	filepath: string,
	contents: string,
	cursorIndex: number,
	ide: IDE,
	lang: AutocompleteLanguageInfo,
) => Promise<RangeInFileWithContents[]> // Changed to RangeInFileWithContents[]

export const getDefinitionsFromLsp: GetLspDefinitionsFunction = async (
	filepath: string,
	contents: string,
	cursorIndex: number,
	ide: IDE,
	lang: AutocompleteLanguageInfo,
): Promise<RangeInFileWithContents[]> => {
	try {
		const ast = await getAst(filepath, contents)
		if (!ast) return []

		const treePath = await getTreePathAtCursor(ast, cursorIndex) // Assumes this function is compatible
		if (!treePath || treePath.length === 0) return []

		const results: RangeInFileWithContents[] = []
		// Iterate from deepest to shallowest node in the path
		for (const node of treePath.reverse()) {
			const definitions = await getDefinitionsForNode(
				filepath, // Pass string filepath
				node,
				ide,
				lang,
			)
			// Add definitions, avoiding duplicates
			for (const def of definitions) {
				if (
					!results.some(
						(r) =>
							r.filepath === def.filepath &&
							r.range.start.line === def.range.start.line &&
							r.contents === def.contents,
					)
				) {
					results.push(def)
				}
			}
		}
		return results
	} catch (e) {
		console.warn("Error getting definitions from LSP: ", e)
		return []
	}
}
