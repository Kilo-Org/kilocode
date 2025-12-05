import { Plugin } from "vite"

// Custom plugin to handle CSS per entry point
// This tracks which CSS belongs to which entry by analyzing the chunk graph

export const cssPerEntryPlugin = (): Plugin => ({
	name: "css-per-entry",
	enforce: "post",
	generateBundle(_options, bundle) {
		// Map to track which chunks belong to which entry
		const entryChunks: Record<string, Set<string>> = {}
		const chunkToEntry: Record<string, string> = {}

		// First pass: identify all entry points and their chunk graphs
		for (const [fileName, chunk] of Object.entries(bundle)) {
			if (chunk.type === "chunk" && chunk.isEntry) {
				const entryName = chunk.name
				entryChunks[entryName] = new Set<string>()
				entryChunks[entryName].add(fileName)
				chunkToEntry[fileName] = entryName

				// Traverse all imports recursively
				const traverseImports = (chunkFileName: string, visited = new Set<string>()) => {
					if (visited.has(chunkFileName)) return
					visited.add(chunkFileName)

					const currentChunk = bundle[chunkFileName]
					if (currentChunk && currentChunk.type === "chunk") {
						entryChunks[entryName].add(chunkFileName)
						chunkToEntry[chunkFileName] = entryName

						// Follow static imports
						currentChunk.imports.forEach((imp) => traverseImports(imp, visited))

						// Follow dynamic imports
						if (currentChunk.dynamicImports) {
							currentChunk.dynamicImports.forEach((imp) => traverseImports(imp, visited))
						}
					}
				}

				traverseImports(fileName)
			}
		}

		// Second pass: collect CSS for each entry based on chunk ownership
		const entryCSS: Record<string, string[]> = {}

		for (const [fileName, asset] of Object.entries(bundle)) {
			if (asset.type === "asset" && fileName.endsWith(".css")) {
				// Try to find which entry this CSS belongs to by checking chunks
				let assignedEntry: string | null = null

				// Check all chunks to see which one references this CSS
				for (const [chunkFileName, chunk] of Object.entries(bundle)) {
					if (chunk.type === "chunk" && chunk.viteMetadata?.importedCss) {
						if (chunk.viteMetadata.importedCss.has(fileName)) {
							// This chunk imports this CSS, find which entry owns this chunk
							assignedEntry = chunkToEntry[chunkFileName]
							if (assignedEntry) break
						}
					}
				}

				// If we found an entry for this CSS, assign it
				if (assignedEntry) {
					if (!entryCSS[assignedEntry]) {
						entryCSS[assignedEntry] = []
					}
					entryCSS[assignedEntry].push(fileName)
				}
			}
		}

		// Third pass: merge CSS for each entry and delete originals
		for (const [entryName, cssFiles] of Object.entries(entryCSS)) {
			if (cssFiles.length > 0) {
				let mergedCSS = ""
				cssFiles.forEach((cssFile) => {
					const asset = bundle[cssFile]
					if (asset && asset.type === "asset") {
						const source =
							typeof asset.source === "string" ? asset.source : new TextDecoder().decode(asset.source)
						mergedCSS += source + "\n"
						delete bundle[cssFile]
					}
				})

				if (mergedCSS) {
					this.emitFile({
						type: "asset",
						fileName: `assets/${entryName}.css`,
						source: mergedCSS,
					})
				}
			}
		}
	},
})
