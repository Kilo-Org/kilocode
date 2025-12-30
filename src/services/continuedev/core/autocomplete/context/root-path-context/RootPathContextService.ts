import { createHash } from "crypto"

import { LRUCache } from "lru-cache"
import { Node as SyntaxNode, Query, Point } from "web-tree-sitter"

import { IDE } from "../../.."
import { getFullLanguageName, getQueryForFile, IGNORE_PATH_PATTERNS, LanguageName } from "../../../util/treeSitter"
import { AutocompleteCodeSnippet, AutocompleteSnippetType } from "../../snippets/types"
import { AstPath } from "../../util/ast"
import { ImportDefinitionsService } from "../ImportDefinitionsService"

export class RootPathContextService {
	private cache = new LRUCache<string, AutocompleteCodeSnippet[]>({
		max: 100,
	})

	constructor(
		private readonly importDefinitionsService: ImportDefinitionsService,
		private readonly ide: IDE,
	) {}

	private static getNodeId(node: SyntaxNode): string {
		return `${node.startIndex}`
	}

	private static TYPES_TO_USE = new Set([
		"arrow_function",
		"generator_function_declaration",
		"program",
		"function_declaration",
		"function_definition",
		"method_definition",
		"method_declaration",
		"class_declaration",
		"class_definition",
	])

	/**
	 * Key comes from hash of parent key and node type and node id.
	 */
	private static keyFromNode(parentKey: string, astNode: SyntaxNode): string {
		return createHash("sha256")
			.update(parentKey)
			.update(astNode.type)
			.update(RootPathContextService.getNodeId(astNode))
			.digest("hex")
	}

	private async getSnippetsForNode(filepath: string, node: SyntaxNode): Promise<AutocompleteCodeSnippet[]> {
		const snippets: AutocompleteCodeSnippet[] = []
		const language = getFullLanguageName(filepath)

		let query: Query | undefined
		switch (node.type) {
			case "program":
				this.importDefinitionsService.get(filepath)
				break
			default:
				query = await getQueryForFile(filepath, `root-path-context-queries/${language}/${node.type}.scm`)
				break
		}

		if (!query) {
			return snippets
		}

		const queries = query.matches(node).map(async (match) => {
			for (const item of match.captures) {
				const endPosition = item.node.endPosition
				const newSnippets = await this.getSnippets(filepath, endPosition, language)
				snippets.push(...newSnippets)
			}
		})

		await Promise.all(queries)

		return snippets
	}

	private async getSnippets(
		filepath: string,
		endPosition: Point,
		language: LanguageName,
	): Promise<AutocompleteCodeSnippet[]> {
		const definitions = await this.ide.gotoDefinition({
			filepath,
			position: {
				line: endPosition.row,
				character: endPosition.column,
			},
		})
		const newSnippets: AutocompleteCodeSnippet[] = await Promise.all(
			definitions
				.filter((definition) => {
					const isIgnoredPath = IGNORE_PATH_PATTERNS[language]?.some((pattern) =>
						pattern.test(definition.filepath),
					)

					return !isIgnoredPath
				})
				.map(
					async (def): Promise<AutocompleteCodeSnippet> => ({
						filepath: def.filepath,
						content: await this.ide.readRangeInFile(def.filepath, def.range),
						type: AutocompleteSnippetType.Code,
					}),
				),
		)

		return newSnippets
	}

	async getContextForPath(filepath: string, astPath: AstPath): Promise<AutocompleteCodeSnippet[]> {
		const snippets: AutocompleteCodeSnippet[] = []

		let parentKey = filepath
		for (const astNode of astPath.filter((node) => RootPathContextService.TYPES_TO_USE.has(node.type))) {
			const key = RootPathContextService.keyFromNode(parentKey, astNode)

			const foundInCache = this.cache.get(key)
			const newSnippets = foundInCache ?? (await this.getSnippetsForNode(filepath, astNode))

			snippets.push(...newSnippets)

			if (!foundInCache) {
				this.cache.set(key, newSnippets)
			}

			parentKey = key
		}

		return snippets
	}
}
