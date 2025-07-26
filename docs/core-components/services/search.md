# Search Services

The search services provide comprehensive file and content search capabilities using high-performance tools like
ripgrep and fuzzy search algorithms. These services enable fast discovery of files, code symbols, and content
across large codebases.

## Location

`src/services/search/` and `src/services/ripgrep/`

## Core Components

### file-search.ts

Provides file system search capabilities with fuzzy matching and filtering.

**Key Features:**

- **Ripgrep integration**: Leverages ripgrep for fast file discovery
- **Fuzzy search**: Uses fzf algorithm for intelligent matching
- **File type detection**: Distinguishes between files and directories
- **Performance optimization**: Configurable limits and caching

### ripgrep/index.ts

Manages ripgrep binary and provides search functionality.

**Key Features:**

- **Binary management**: Handles ripgrep binary location and execution
- **Cross-platform support**: Works on Windows, macOS, and Linux
- **Pattern matching**: Advanced regex and glob pattern support
- **Output processing**: Structured processing of search results

## File Search Architecture

### Search Execution

```typescript
export async function executeRipgrep({
	args,
	workspacePath,
	limit = 500,
}: {
	args: string[]
	workspacePath: string
	limit?: number
}): Promise<FileResult[]> {
	const rgPath = await getBinPath(vscode.env.appRoot)

	return new Promise((resolve, reject) => {
		const rgProcess = childProcess.spawn(rgPath, args)
		const rl = readline.createInterface({
			input: rgProcess.stdout,
			crlfDelay: Infinity,
		})

		const fileResults: FileResult[] = []
		const dirSet = new Set<string>()
		let count = 0

		rl.on("line", (line) => {
			if (count < limit) {
				const relativePath = path.relative(workspacePath, line)

				// Add file result
				fileResults.push({
					path: relativePath,
					type: "file",
					label: path.basename(relativePath),
				})

				// Extract parent directories
				let dirPath = path.dirname(relativePath)
				while (dirPath && dirPath !== "." && dirPath !== "/") {
					dirSet.add(dirPath)
					dirPath = path.dirname(dirPath)
				}

				count++
			}
		})

		rl.on("close", () => {
			const dirResults = Array.from(dirSet).map((dirPath) => ({
				path: dirPath,
				type: "folder" as const,
				label: path.basename(dirPath),
			}))

			resolve([...fileResults, ...dirResults])
		})
	})
}
```

### File Discovery

```typescript
export async function executeRipgrepForFiles(workspacePath: string, limit: number = 5000): Promise<FileResult[]> {
	const args = [
		"--files",
		"--follow",
		"--hidden",
		"-g",
		"!**/node_modules/**",
		"-g",
		"!**/.git/**",
		"-g",
		"!**/out/**",
		"-g",
		"!**/dist/**",
		workspacePath,
	]

	return executeRipgrep({ args, workspacePath, limit })
}
```

### Fuzzy Search Integration

```typescript
export async function searchWorkspaceFiles(
	query: string,
	workspacePath: string,
	limit: number = 20,
): Promise<FileResult[]> {
	// Get all files and directories
	const allItems = await executeRipgrepForFiles(workspacePath, 5000)

	if (!query.trim()) {
		return allItems.slice(0, limit)
	}

	// Create search items for fzf
	const searchItems = allItems.map((item) => ({
		original: item,
		searchStr: `${item.path} ${item.label || ""}`,
	}))

	// Run fuzzy search
	const fzf = new Fzf(searchItems, {
		selector: (item) => item.searchStr,
		tiebreakers: [byLengthAsc],
		limit: limit,
	})

	const fzfResults = fzf.find(query).map((result) => result.item.original)

	// Verify file types
	const verifiedResults = await Promise.all(
		fzfResults.map(async (result) => {
			const fullPath = path.join(workspacePath, result.path)
			if (fs.existsSync(fullPath)) {
				const isDirectory = fs.lstatSync(fullPath).isDirectory()
				return {
					...result,
					path: result.path.toPosix(),
					type: isDirectory ? ("folder" as const) : ("file" as const),
				}
			}
			return result
		}),
	)

	return verifiedResults
}
```

## Ripgrep Integration

### Binary Management

```typescript
// In ripgrep/index.ts
export async function getBinPath(appRoot: string): Promise<string | null> {
	const platform = process.platform
	const arch = process.arch

	// Determine binary name based on platform
	const binaryName = platform === "win32" ? "rg.exe" : "rg"

	// Search in various locations
	const searchPaths = [
		path.join(appRoot, "node_modules", "@vscode", "ripgrep", "bin", binaryName),
		path.join(appRoot, "node_modules", "vscode-ripgrep", "bin", binaryName),
		// System PATH
		binaryName,
	]

	for (const searchPath of searchPaths) {
		if (await fileExists(searchPath)) {
			return searchPath
		}
	}

	return null
}
```

### Search Patterns

Common ripgrep patterns used throughout the system:

#### File Listing

```bash
rg --files --follow --hidden
   -g "!**/node_modules/**"
   -g "!**/.git/**"
   -g "!**/out/**"
   -g "!**/dist/**"
```

#### Content Search

```bash
rg --json --context 2
   --max-count 100
   --type-add "web:*.{html,css,js,ts,jsx,tsx}"
   --type web
   "search pattern"
```

#### Symbol Search

```bash
rg --json --type-add "code:*.{js,ts,py,java,cpp,c,h}"
   --type code
   "^(class|function|interface|type)\s+\w+"
```

## Search Result Processing

### Result Types

```typescript
export type FileResult = {
	path: string
	type: "file" | "folder"
	label?: string
}

export type ContentResult = {
	path: string
	line: number
	column: number
	match: string
	context: {
		before: string[]
		after: string[]
	}
}

export type SymbolResult = {
	path: string
	symbol: string
	type: "class" | "function" | "interface" | "type" | "variable"
	line: number
	scope?: string
}
```

### Result Filtering

```typescript
// Filter results through RooIgnore controller
const allowedResults = rooIgnoreController ? rooIgnoreController.filterPaths(results.map((r) => r.path)) : results

// Apply additional filters
const filteredResults = allowedResults
	.filter((result) => !result.path.includes("node_modules"))
	.filter((result) => !result.path.startsWith(".git/"))
	.slice(0, limit)
```

## Performance Optimizations

### Caching Strategy

```typescript
class SearchCache {
	private fileCache = new Map<string, FileResult[]>()
	private contentCache = new Map<string, ContentResult[]>()
	private cacheTimeout = 5 * 60 * 1000 // 5 minutes

	async getFiles(workspacePath: string): Promise<FileResult[]> {
		const cacheKey = `files:${workspacePath}`
		const cached = this.fileCache.get(cacheKey)

		if (cached && this.isCacheValid(cacheKey)) {
			return cached
		}

		const results = await executeRipgrepForFiles(workspacePath)
		this.fileCache.set(cacheKey, results)
		return results
	}
}
```

### Streaming Results

```typescript
export function streamSearchResults(
	query: string,
	workspacePath: string,
	callback: (result: FileResult) => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const rgProcess = childProcess.spawn(rgPath, args)
		const rl = readline.createInterface({ input: rgProcess.stdout })

		rl.on("line", (line) => {
			const result = parseSearchResult(line)
			if (result) {
				callback(result)
			}
		})

		rl.on("close", resolve)
		rgProcess.on("error", reject)
	})
}
```

### Parallel Processing

```typescript
export async function parallelSearch(queries: string[], workspacePath: string): Promise<Map<string, FileResult[]>> {
	const results = new Map<string, FileResult[]>()

	await Promise.all(
		queries.map(async (query) => {
			const searchResults = await searchWorkspaceFiles(query, workspacePath)
			results.set(query, searchResults)
		}),
	)

	return results
}
```

## Integration Points

### Tool Integration

Search services are integrated into various tools:

#### Codebase Search Tool

```typescript
// In codebaseSearchTool.ts
const searchService = new FileSearchService()
const results = await searchService.searchWorkspaceFiles(query, workspacePath)
```

#### List Files Tool

```typescript
// In listFilesTool.ts
const files = await executeRipgrepForFiles(workspacePath, maxFiles)
const filteredFiles = rooIgnoreController.filterPaths(files)
```

### Autocomplete Integration

```typescript
// In AutocompleteProvider.ts
const fileResults = await searchWorkspaceFiles(partialPath, workspacePath, 10)
const suggestions = fileResults.map((result) => ({
	label: result.label,
	insertText: result.path,
	kind: result.type === "folder" ? CompletionItemKind.Folder : CompletionItemKind.File,
}))
```

## Configuration

### Search Settings

```typescript
interface SearchSettings {
	maxResults: number // 500
	includeHidden: boolean // true
	followSymlinks: boolean // true
	excludePatterns: string[] // ["node_modules", ".git", "dist"]
	includePatterns: string[] // ["*.ts", "*.js", "*.py"]
	caseSensitive: boolean // false
	useRegex: boolean // false
}
```

### Performance Settings

```typescript
interface PerformanceSettings {
	cacheTimeout: number // 300000 (5 minutes)
	maxCacheSize: number // 1000 entries
	streamingThreshold: number // 1000 results
	parallelSearchLimit: number // 5 concurrent searches
}
```

## Error Handling

### Binary Not Found

```typescript
if (!rgPath) {
	throw new Error(
		"ripgrep binary not found. Please ensure VS Code is properly installed " + "or install ripgrep manually.",
	)
}
```

### Search Timeout

```typescript
const searchTimeout = setTimeout(() => {
	rgProcess.kill()
	reject(new Error("Search operation timed out"))
}, 30000) // 30 second timeout

rgProcess.on("close", () => {
	clearTimeout(searchTimeout)
	resolve(results)
})
```

### Invalid Patterns

```typescript
try {
	const results = await executeRipgrep({ args, workspacePath })
	return results
} catch (error) {
	if (error.message.includes("invalid regex")) {
		throw new Error(`Invalid search pattern: ${query}`)
	}
	throw error
}
```

## Testing

### Unit Tests

```typescript
describe("FileSearch", () => {
	it("should find files matching pattern", async () => {
		const results = await searchWorkspaceFiles("*.ts", testWorkspace)
		expect(results).toHaveLength(5)
		expect(results[0].type).toBe("file")
	})

	it("should handle empty query", async () => {
		const results = await searchWorkspaceFiles("", testWorkspace, 10)
		expect(results).toHaveLength(10)
	})
})
```

### Integration Tests

```typescript
describe("Search Integration", () => {
	it("should integrate with RooIgnore", async () => {
		const results = await searchWorkspaceFiles("test", workspaceWithIgnore)
		expect(results.some((r) => r.path.includes("ignored"))).toBe(false)
	})
})
```

## Future Enhancements

- **Semantic search**: AI-powered semantic code search
- **Index-based search**: Pre-built search indices for faster results
- **Real-time search**: Live search results as you type
- **Search history**: Remember and suggest previous searches
- **Advanced filters**: More sophisticated filtering options
- **Search analytics**: Track search patterns and optimize performance
