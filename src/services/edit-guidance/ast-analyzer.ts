// kilocode_change - new file

/**
 * AST Analyzer for Edit Guidance
 * Analyzes code structure to find related code, references, and dependencies
 */

import type { CodeAnalysis, Dependency, CodeReference, ImportStatement, ExportStatement } from "./types"
import { AnalysisError } from "./types"

export interface ASTAnalyzerConfig {
	/** Whether to include test files in analysis */
	includeTests?: boolean
	/** Whether to include documentation files in analysis */
	includeDocumentation?: boolean
	/** Maximum depth for dependency analysis */
	maxDependencyDepth?: number
	/** Whether to analyze node_modules */
	analyzeNodeModules?: boolean
}

export class ASTAnalyzer {
	private config: Required<ASTAnalyzerConfig>
	private cache: Map<string, CodeAnalysis>

	constructor(config: ASTAnalyzerConfig = {}) {
		this.config = {
			includeTests: config.includeTests ?? true,
			includeDocumentation: config.includeDocumentation ?? true,
			maxDependencyDepth: config.maxDependencyDepth ?? 3,
			analyzeNodeModules: config.analyzeNodeModules ?? false,
		}
		this.cache = new Map()
	}

	/**
	 * Analyze a single file
	 */
	async analyzeFile(filePath: string, content: string): Promise<CodeAnalysis> {
		try {
			// Check cache
			const cacheKey = `${filePath}:${content.length}`
			if (this.cache.has(cacheKey)) {
				return this.cache.get(cacheKey)!
			}

			const language = this.detectLanguage(filePath)

			const analysis: CodeAnalysis = {
				filePath,
				language,
				dependencies: this.extractDependencies(content, language),
				references: this.extractReferences(content, language, filePath),
				imports: this.extractImports(content, language, filePath),
				exports: this.extractExports(content, language, filePath),
			}

			// Cache the result
			this.cache.set(cacheKey, analysis)

			return analysis
		} catch (error) {
			throw new AnalysisError(`Failed to analyze file ${filePath}: ${error}`, filePath, error)
		}
	}

	/**
	 * Find all references to a symbol across the project
	 */
	async findReferences(symbolName: string, filePath: string, projectFiles: string[]): Promise<CodeReference[]> {
		try {
			const references: CodeReference[] = []

			// Analyze the source file to find the definition
			const sourceContent = await this.readFile(filePath)
			const sourceAnalysis = await this.analyzeFile(filePath, sourceContent)

			// Find the definition
			const definition = sourceAnalysis.references.find((ref) => ref.name === symbolName && ref.isDefinition)

			if (!definition) {
				return []
			}

			// Search for references in other files
			for (const file of projectFiles) {
				if (file === filePath) continue

				try {
					const content = await this.readFile(file)
					const analysis = await this.analyzeFile(file, content)

					// Find references to the symbol
					const fileReferences = analysis.references.filter(
						(ref) => ref.name === symbolName && !ref.isDefinition,
					)

					references.push(...fileReferences)
				} catch (error) {
					// Skip files that can't be analyzed
					continue
				}
			}

			return references
		} catch (error) {
			throw new AnalysisError(`Failed to find references for ${symbolName}: ${error}`, filePath, error)
		}
	}

	/**
	 * Find dependencies of a file
	 */
	async findDependencies(filePath: string, depth: number = 1): Promise<Dependency[]> {
		try {
			if (depth > this.config.maxDependencyDepth) {
				return []
			}

			const content = await this.readFile(filePath)
			const analysis = await this.analyzeFile(filePath, content)

			const dependencies: Dependency[] = []

			for (const dep of analysis.dependencies) {
				// Skip node_modules if not configured to analyze
				if (!this.config.analyzeNodeModules && dep.isExternal) {
					continue
				}

				dependencies.push(dep)

				// Recursively find dependencies of dependencies
				if (!dep.isExternal && dep.source) {
					const subDeps = await this.findDependencies(dep.source, depth + 1)
					dependencies.push(...subDeps)
				}
			}

			return dependencies
		} catch (error) {
			throw new AnalysisError(`Failed to find dependencies for ${filePath}: ${error}`, filePath, error)
		}
	}

	/**
	 * Analyze a change and identify affected files
	 */
	async analyzeChange(
		filePath: string,
		changeType: "create" | "update" | "delete",
		symbolName?: string,
	): Promise<string[]> {
		try {
			const affectedFiles: Set<string> = new Set()

			if (changeType === "delete") {
				// Find all files that import from this file
				const content = await this.readFile(filePath)
				const analysis = await this.analyzeFile(filePath, content)

				// Get all exports from this file
				const exports = analysis.exports.map((exp) => exp.name)

				// Find files that import these exports
				// TODO: Implement project-wide search
				// For now, just return the file itself
				affectedFiles.add(filePath)
			} else if (changeType === "update" && symbolName) {
				// Find all references to the symbol
				// TODO: Implement project-wide search
				// For now, just return the file itself
				affectedFiles.add(filePath)
			} else {
				affectedFiles.add(filePath)
			}

			return Array.from(affectedFiles)
		} catch (error) {
			throw new AnalysisError(`Failed to analyze change: ${error}`, filePath, error)
		}
	}

	/**
	 * Detect programming language from file path
	 */
	private detectLanguage(filePath: string): string {
		const ext = filePath.split(".").pop()?.toLowerCase()

		const languageMap: Record<string, string> = {
			ts: "typescript",
			tsx: "typescript",
			js: "javascript",
			jsx: "javascript",
			py: "python",
			rb: "ruby",
			go: "go",
			rs: "rust",
			java: "java",
			kt: "kotlin",
			c: "c",
			cpp: "cpp",
			cs: "csharp",
			php: "php",
			scala: "scala",
			swift: "swift",
			dart: "dart",
			lua: "lua",
			r: "r",
			m: "objective-c",
		}

		return languageMap[ext || ""] || "unknown"
	}

	/**
	 * Extract dependencies from code
	 */
	private extractDependencies(content: string, language: string): Dependency[] {
		const dependencies: Dependency[] = []

		// Extract import/require statements
		const importPatterns = {
			typescript: [
				/import\s+.*?from\s+['"]([^'"]+)['"]/g,
				/import\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g,
				/require\(['"]([^'"]+)['"]\)/g,
			],
			javascript: [
				/import\s+.*?from\s+['"]([^'"]+)['"]/g,
				/import\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g,
				/require\(['"]([^'"]+)['"]\)/g,
			],
			python: [/from\s+(\S+)\s+import/g, /import\s+(\S+)/g],
			ruby: [/require\s+['"]([^'"]+)['"]/g],
			go: [/import\s+['"]([^'"]+)['"]/g],
		}

		const patterns = importPatterns[language as keyof typeof importPatterns] || importPatterns.javascript

		for (const pattern of patterns) {
			let match
			while ((match = pattern.exec(content)) !== null) {
				const moduleName = match[1]
				dependencies.push({
					name: moduleName,
					type:
						language === "python"
							? "import"
							: language === "javascript" || language === "typescript"
								? "import"
								: "require",
					source: moduleName,
					isExternal: this.isExternalDependency(moduleName),
				})
			}
		}

		return dependencies
	}

	/**
	 * Extract code references (definitions and usages)
	 */
	private extractReferences(content: string, language: string, filePath: string): CodeReference[] {
		const references: CodeReference[] = []

		// Extract function definitions
		const functionPatterns = {
			typescript: [
				/function\s+(\w+)\s*\(/g,
				/const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g,
				/export\s+(?:async\s+)?function\s+(\w+)/g,
			],
			javascript: [
				/function\s+(\w+)\s*\(/g,
				/const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g,
				/export\s+(?:async\s+)?function\s+(\w+)/g,
			],
			python: [/def\s+(\w+)\s*\(/g],
			ruby: [/def\s+(\w+)/g],
			go: [/func\s+(\w+)\s*\(/g],
		}

		const patterns = functionPatterns[language as keyof typeof functionPatterns] || functionPatterns.javascript

		const lines = content.split("\n")
		for (const pattern of patterns) {
			let match
			while ((match = pattern.exec(content)) !== null) {
				const name = match[1]
				const position = this.getPosition(content, match.index)

				references.push({
					name,
					type: "function",
					filePath,
					line: position.line,
					column: position.column,
					isDefinition: true,
				})
			}
		}

		// Extract class definitions
		const classPatterns = {
			typescript: [/class\s+(\w+)/g],
			javascript: [/class\s+(\w+)/g],
			python: [/class\s+(\w+)/g],
			ruby: [/class\s+(\w+)/g],
			java: [/class\s+(\w+)/g],
			kotlin: [/class\s+(\w+)/g],
		}

		const classPatternsForLang = classPatterns[language as keyof typeof classPatterns] || classPatterns.javascript
		for (const classPattern of classPatternsForLang) {
			let classMatch
			while ((classMatch = classPattern.exec(content)) !== null) {
				const name = classMatch[1]
				const position = this.getPosition(content, classMatch.index)

				references.push({
					name,
					type: "class",
					filePath,
					line: position.line,
					column: position.column,
					isDefinition: true,
				})
			}
		}

		return references
	}

	/**
	 * Extract import statements
	 */
	private extractImports(content: string, language: string, filePath: string): ImportStatement[] {
		const imports: ImportStatement[] = []

		const importPatterns = {
			typescript: [
				/import\s+([\w*]+)\s+from\s+['"]([^'"]+)['"]/g,
				/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
				/import\s+['"]([^'"]+)['"]/g,
			],
			javascript: [
				/import\s+([\w*]+)\s+from\s+['"]([^'"]+)['"]/g,
				/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
				/import\s+['"]([^'"]+)['"]/g,
			],
			python: [/from\s+(\S+)\s+import\s+(\S+)/g, /import\s+(\S+)/g],
		}

		const patterns = importPatterns[language as keyof typeof importPatterns] || importPatterns.javascript

		for (const pattern of patterns) {
			let match
			while ((match = pattern.exec(content)) !== null) {
				const lines = content.split("\n")
				const position = this.getPosition(content, match.index)

				imports.push({
					module: match[2] || match[1],
					name: match[1],
					isDefault: match[0].includes("import ") && !match[0].includes("{"),
					isTypeOnly: match[0].includes("type "),
					filePath,
					line: position.line,
				})
			}
		}

		return imports
	}

	/**
	 * Extract export statements
	 */
	private extractExports(content: string, language: string, filePath: string): ExportStatement[] {
		const exports: ExportStatement[] = []

		const exportPatterns = {
			typescript: [
				/export\s+(?:async\s+)?function\s+(\w+)/g,
				/export\s+const\s+(\w+)/g,
				/export\s+class\s+(\w+)/g,
				/export\s+default\s+(?:class\s+)?(\w+)/g,
				/export\s+\{([^}]+)\}/g,
			],
			javascript: [
				/export\s+(?:async\s+)?function\s+(\w+)/g,
				/export\s+const\s+(\w+)/g,
				/export\s+class\s+(\w+)/g,
				/export\s+default\s+(?:class\s+)?(\w+)/g,
				/export\s+\{([^}]+)\}/g,
			],
			python: [/__all__\s*=\s*\[([^\]]+)\]/g],
		}

		const patterns = exportPatterns[language as keyof typeof exportPatterns] || exportPatterns.javascript

		for (const pattern of patterns) {
			let match
			while ((match = pattern.exec(content)) !== null) {
				const lines = content.split("\n")
				const position = this.getPosition(content, match.index)

				exports.push({
					name: match[1] || match[0],
					type: "function",
					isDefault: match[0].includes("default"),
					filePath,
					line: position.line,
				})
			}
		}

		return exports
	}

	/**
	 * Check if a dependency is external (node_modules, etc.)
	 */
	private isExternalDependency(moduleName: string): boolean {
		return moduleName.startsWith(".") || moduleName.startsWith("/") || moduleName.includes("node_modules")
	}

	/**
	 * Get line and column from character position
	 */
	private getPosition(content: string, index: number): { line: number; column: number } {
		const lines = content.substring(0, index).split("\n")
		return {
			line: lines.length,
			column: lines[lines.length - 1].length,
		}
	}

	/**
	 * Read file content (placeholder - will integrate with VSCode API)
	 */
	private async readFile(filePath: string): Promise<string> {
		// TODO: Integrate with VSCode API or file system
		// For now, return empty string
		return ""
	}

	/**
	 * Clear the cache
	 */
	clearCache(): void {
		this.cache.clear()
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: ASTAnalyzer | null = null

export function getASTAnalyzer(config?: ASTAnalyzerConfig): ASTAnalyzer {
	if (!instance) {
		instance = new ASTAnalyzer(config)
	}
	return instance
}

export function resetASTAnalyzer(): void {
	instance = null
}
