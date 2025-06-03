//PLANREF: continue/core/autocomplete/constants/AutocompleteLanguageInfo.ts
/**
 * Interface for language-specific autocomplete information
 */
export interface AutocompleteLanguageInfo {
	name: string
	singleLineComment: string
	topLevelKeywords: string[]
}

/**
 * Get the language info for a specific language ID
 * @param languageId Language ID
 * @returns Language info
 */
export function getLanguageInfo(languageId: string): AutocompleteLanguageInfo {
	switch (languageId.toLowerCase()) {
		case "typescript":
		case "javascript":
		case "tsx":
		case "jsx":
			return {
				name: languageId,
				singleLineComment: "//",
				topLevelKeywords: ["function", "class", "const", "let", "var", "import", "export"],
			}
		case "python":
			return {
				name: languageId,
				singleLineComment: "#",
				topLevelKeywords: ["def", "class", "import", "from", "if", "for", "while"],
			}
		case "java":
		case "c":
		case "cpp":
		case "csharp":
		case "go":
			return {
				name: languageId,
				singleLineComment: "//",
				topLevelKeywords: ["class", "interface", "function", "struct", "enum"],
			}
		case "ruby":
			return {
				name: languageId,
				singleLineComment: "#",
				topLevelKeywords: ["def", "class", "module", "require"],
			}
		case "rust":
			return {
				name: languageId,
				singleLineComment: "//",
				topLevelKeywords: ["fn", "struct", "enum", "impl", "trait", "mod", "use"],
			}
		case "php":
			return {
				name: languageId,
				singleLineComment: "//",
				topLevelKeywords: ["function", "class", "namespace", "require", "include"],
			}
		default:
			return {
				name: languageId,
				singleLineComment: "//",
				topLevelKeywords: [],
			}
	}
}

/**
 * Get language info for a file path
 * @param filepath File path
 * @returns Language info
 */
export function languageForFilepath(filepath: string): AutocompleteLanguageInfo {
	const ext = filepath.split(".").pop()?.toLowerCase() || ""

	switch (ext) {
		case "ts":
			return getLanguageInfo("typescript")
		case "js":
			return getLanguageInfo("javascript")
		case "tsx":
			return getLanguageInfo("tsx")
		case "jsx":
			return getLanguageInfo("jsx")
		case "py":
			return getLanguageInfo("python")
		case "java":
			return getLanguageInfo("java")
		case "c":
			return getLanguageInfo("c")
		case "cpp":
		case "cc":
		case "cxx":
			return getLanguageInfo("cpp")
		case "cs":
			return getLanguageInfo("csharp")
		case "go":
			return getLanguageInfo("go")
		case "rb":
			return getLanguageInfo("ruby")
		case "rs":
			return getLanguageInfo("rust")
		case "php":
			return getLanguageInfo("php")
		default:
			return getLanguageInfo("")
	}
}
