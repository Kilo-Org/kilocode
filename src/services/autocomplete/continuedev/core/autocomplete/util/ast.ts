import { Node as SyntaxNode, Tree } from "web-tree-sitter"

import { getParserForFile } from "../../util/treeSitter"

export type AstPath = SyntaxNode[]

export async function getAst(filepath: string, fileContents: string): Promise<Tree | undefined> {
	const parser = await getParserForFile(filepath)

	if (!parser) {
		return undefined
	}

	try {
		const ast = parser.parse(fileContents)
		return ast || undefined
	} catch {
		return undefined
	}
}

export async function getTreePathAtCursor(ast: Tree, cursorIndex: number): Promise<AstPath> {
	const path = [ast.rootNode]
	while (path[path.length - 1].childCount > 0) {
		let foundChild = false
		for (const child of path[path.length - 1].children) {
			if (child && child.startIndex <= cursorIndex && child.endIndex >= cursorIndex) {
				path.push(child)
				foundChild = true
				break
			}
		}

		if (!foundChild) {
			break
		}
	}

	return path
}
