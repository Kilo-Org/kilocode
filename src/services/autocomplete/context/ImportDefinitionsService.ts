//PLANREF: continue/extensions/vscode/src/autocomplete/lsp.ts
import { RangeInFileWithContents } from "../ide-types"
import { findUriInDirs } from "../templating/uri"
import { IDE } from "../utils/ide"
import { PrecalculatedLruCache } from "../utils/LruCache"
import { getParserForFile, getFullLanguageName, getQueryForFile } from "../utils/treeSitter"

interface FileInfo {
	imports: { [key: string]: RangeInFileWithContents[] }
}

export class ImportDefinitionsService {
	static N = 10

	private cache: PrecalculatedLruCache<FileInfo> = new PrecalculatedLruCache<FileInfo>(
		this._getFileInfo.bind(this),
		ImportDefinitionsService.N,
	)

	constructor(private readonly ide: IDE) {
		ide.onDidChangeActiveTextEditor((filepath) => {
			this.cache
				.initKey(filepath)
				.catch((e) => console.warn(`Failed to initialize ImportDefinitionService: ${e.message}`))
		})
	}

	get(filepath: string): FileInfo | undefined {
		return this.cache.get(filepath)
	}

	private async _getFileInfo(filepath: string): Promise<FileInfo | null> {
		if (filepath.endsWith(".ipynb")) {
			// Commenting out this line was the solution to https://github.com/continuedev/continue/issues/1463
			return null
		}

		const parser = await getParserForFile(filepath)
		if (!parser) {
			return {
				imports: {},
			}
		}

		let fileContents: string | undefined = undefined
		try {
			const { foundInDir } = findUriInDirs(filepath, await this.ide.getWorkspaceDirs())
			if (!foundInDir) {
				return null
			} else {
				fileContents = await this.ide.readFile(filepath)
			}
		} catch (err) {
			// File removed
			return null
		}

		const ast = parser.parse(fileContents, undefined, {
			includedRanges: [
				{
					startIndex: 0,
					endIndex: 10_000,
					startPosition: { row: 0, column: 0 },
					endPosition: { row: 100, column: 0 },
				},
			],
		})
		const language = getFullLanguageName(filepath)
		const query = await getQueryForFile(filepath, `import-queries/${language}.scm`)
		if (!query) {
			return {
				imports: {},
			}
		}

		// Using non-optional matches since query is already checked for null above
		const matches = query.matches(ast.rootNode)

		const fileInfo: FileInfo = {
			imports: {},
		}
		for (const match of matches) {
			const startPosition = match.captures[0].node.startPosition
			const defs = await this.ide.gotoDefinition({
				filepath: filepath,
				position: {
					line: startPosition.row,
					character: startPosition.column,
				},
			})
			fileInfo.imports[match.captures[0].node.text] = await Promise.all(
				defs.map(async (def) => ({
					...def,
					contents: await this.ide.readRangeInFile(def.filepath, def.range),
				})),
			)
		}

		return fileInfo
	}
}
