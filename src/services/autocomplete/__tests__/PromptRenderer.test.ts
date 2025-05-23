import { PromptRenderer, type PromptOptions as _PromptOptions } from "../PromptRenderer"
import { type CodeContext, type CodeContextDefinition as _CodeContextDefinition } from "../ContextGatherer"
import { type AutocompleteLanguageInfo, getLanguageInfo } from "../AutocompleteLanguageInfo"
import { type AutocompleteTemplate, getTemplateForModel } from "../templating/AutocompleteTemplate"
import { getStopTokens } from "../templating/getStopTokens"
import * as vscode from "vscode"

// Mock dependencies
jest.mock("../templating/AutocompleteTemplate", () => ({
	getTemplateForModel: jest.fn(),
}))
jest.mock("../templating/getStopTokens", () => ({
	getStopTokens: jest.fn(),
}))
jest.mock("../AutocompleteLanguageInfo", () => ({
	getLanguageInfo: jest.fn(),
}))

// Mock vscode for activeTextEditor and workspaceFolders
jest.mock("vscode", () => ({
	window: {
		activeTextEditor: undefined, // Default to undefined, can be set in tests
	},
	workspace: {
		workspaceFolders: undefined, // Default to undefined
	},
	Uri: {
		// Basic Uri mock for getUriPathBasename
		parse: jest.fn((uriStr) => ({
			fsPath: uriStr.startsWith("file://") ? uriStr.substring(7) : uriStr,
			path: uriStr.startsWith("file://") ? uriStr.substring(7) : uriStr,
			toString: () => uriStr,
		})),
		file: jest.fn((pathStr) => ({
			fsPath: pathStr,
			path: pathStr,
			toString: () => `file://${pathStr}`,
		})),
	},
}))

describe("PromptRenderer", () => {
	let promptRenderer: PromptRenderer
	const mockDefaultModel = "test-model"

	const mockPythonLangInfo: AutocompleteLanguageInfo = {
		name: "Python",
		singleLineComment: "#",
		topLevelKeywords: ["def", "class"], // Example keywords
	}

	const mockTypeScriptLangInfo: AutocompleteLanguageInfo = {
		name: "TypeScript",
		singleLineComment: "//",
		topLevelKeywords: ["function", "class"], // Example keywords
	}

	beforeEach(() => {
		promptRenderer = new PromptRenderer({}, mockDefaultModel)
		;(getLanguageInfo as jest.Mock).mockReturnValue(mockTypeScriptLangInfo) // Default mock
		;(getStopTokens as jest.Mock).mockReturnValue(["\n\n", "function"])
		;(vscode.window.activeTextEditor as any) = {
			document: { uri: vscode.Uri.file("/test/project/file.ts") },
		}
		;(vscode.workspace.workspaceFolders as any) = [
			{ uri: vscode.Uri.file("/test/project"), name: "project", index: 0 },
		]
	})

	afterEach(() => {
		jest.clearAllMocks()
	})

	const basicCodeContext: CodeContext = {
		currentLine: "  const x = 1",
		precedingLines: ["function greet() {", "  // A comment"],
		followingLines: ["  return x;", "}"],
		imports: [],
		definitions: [],
	}

	const codeContextWithImports: CodeContext = {
		...basicCodeContext,
		imports: ['import fs from "fs";', 'import path from "path";'],
	}

	const codeContextWithDefinitions: CodeContext = {
		...basicCodeContext,
		definitions: [
			{
				filepath: "file:///utils/math.ts",
				content: "export function add(a, b) {\n  return a + b;\n}",
				range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
				source: "lsp",
			},
			{
				filepath: "file:///helpers/string.ts",
				content: 'export const GREETING = "Hello";',
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 30 } },
				source: "recent_edit",
			},
		],
	}

	it("should render a simple prompt using a string template", () => {
		const mockTemplate: AutocompleteTemplate = {
			template:
				"Prefix: {{{prefix}}} Suffix: {{{suffix}}} File: {{{filename}}} Repo: {{{reponame}}} Lang: {{{language}}}",
			completionOptions: { stop: ["stop1"] },
		}
		;(getTemplateForModel as jest.Mock).mockReturnValue(mockTemplate)

		const result = promptRenderer.renderPrompt(basicCodeContext, []) // Added empty array for snippets

		expect(getTemplateForModel).toHaveBeenCalledWith(mockDefaultModel)
		expect(result.prompt).toBe(
			"Prefix: function greet() {\n  // A comment\n  const x = 1 Suffix: \n  return x;\n} File: file.ts Repo: project Lang: TypeScript",
		)
		expect(result.prefix).toBe("function greet() {\n  // A comment\n  const x = 1")
		expect(result.suffix).toBe("\n  return x;\n}")
		expect(result.completionOptions).toEqual(
			expect.objectContaining({
				stop: ["\n\n", "function"], // From the global getStopTokens mock
			}),
		)
	})

	it("should render a prompt using a function template", () => {
		const mockTemplateFn = jest.fn(
			(prefix, suffix, filename, reponame, lang, snippets, workspaceUris) =>
				`FUNC_TPL: ${prefix} | ${suffix} | ${filename} | ${reponame} | ${lang} | Snippets: ${snippets.length} | WS: ${workspaceUris.length}`,
		)
		const mockTemplate: AutocompleteTemplate = {
			template: mockTemplateFn,
			completionOptions: {},
		}
		;(getTemplateForModel as jest.Mock).mockReturnValue(mockTemplate)

		promptRenderer.renderPrompt(basicCodeContext, []) // Added empty array for snippets
		expect(mockTemplateFn).toHaveBeenCalledWith(
			"function greet() {\n  // A comment\n  const x = 1", // prefix
			"\n  return x;\n}", // suffix
			"/test/project/file.ts", // filepath
			"project", // reponame
			"TypeScript", // langName
			[], // snippets
			["file:///test/project"], // workspaceUris
		)
	})

	it("should include imports when enabled and context has imports (string template)", () => {
		const mockTemplate: AutocompleteTemplate = {
			template: "{{{prefix}}}", // Only care about prefix for this test
			completionOptions: {},
		}
		;(getTemplateForModel as jest.Mock).mockReturnValue(mockTemplate)
		;(getLanguageInfo as jest.Mock).mockReturnValue(mockPythonLangInfo)

		const result = promptRenderer.renderPrompt(codeContextWithImports, [], {
			includeImports: true,
			language: "python",
		}) // Added empty array for snippets
		expect(result.prefix).toContain('// Path: file.ts\nimport fs from "fs";') // Assuming default filename from setup
		expect(result.prefix).toContain('// Path: file.ts\nimport path from "path";')
		expect(result.prefix).toContain("function greet() {\n  // A comment\n  const x = 1")
	})

	it("should include definitions when enabled and context has definitions (string template)", () => {
		const mockTemplate: AutocompleteTemplate = {
			template: "{{{prefix}}}",
			completionOptions: {},
		}
		;(getTemplateForModel as jest.Mock).mockReturnValue(mockTemplate)

		const result = promptRenderer.renderPrompt(codeContextWithDefinitions, [], { includeDefinitions: true }) // Added empty array for snippets
		expect(result.prefix).toContain("// Path: math.ts\nexport function add(a, b) {\n  return a + b;\n}")
		expect(result.prefix).toContain('// Path: string.ts\nexport const GREETING = "Hello";')
		expect(result.prefix).toContain("function greet() {\n  // A comment\n  const x = 1")
	})

	it("should use compilePrefixSuffix if template provides it", () => {
		const mockCompileFn = jest.fn(
			(prefix, suffix, _filepath, _reponame, _snippets, _workspaceUris) =>
				[`COMPILED: ${prefix}`, `COMPILED_SUFFIX: ${suffix}`] as [string, string],
		)
		const mockTemplate: AutocompleteTemplate = {
			template: "{{{prefix}}}{{{suffix}}}",
			compilePrefixSuffix: mockCompileFn,
			completionOptions: {},
		}
		;(getTemplateForModel as jest.Mock).mockReturnValue(mockTemplate)

		const result = promptRenderer.renderPrompt(basicCodeContext, []) // Added empty array for snippets
		expect(mockCompileFn).toHaveBeenCalled()
		expect(result.prefix).toBe("COMPILED: function greet() {\n  // A comment\n  const x = 1")
		expect(result.suffix).toBe("COMPILED_SUFFIX: \n  return x;\n}")
		expect(result.prompt).toBe(
			"COMPILED: function greet() {\n  // A comment\n  const x = 1COMPILED_SUFFIX: \n  return x;\n}",
		)
	})

	it("should handle empty suffix correctly by defaulting to newline", () => {
		const contextWithoutFollowing: CodeContext = { ...basicCodeContext, followingLines: [] }
		const mockTemplate: AutocompleteTemplate = { template: "{{{prefix}}}---{{{suffix}}}", completionOptions: {} }
		;(getTemplateForModel as jest.Mock).mockReturnValue(mockTemplate)

		const result = promptRenderer.renderPrompt(contextWithoutFollowing, []) // Added empty array for snippets
		expect(result.suffix).toBe("\n")
		expect(result.prompt).toContain("---") // Ensure suffix was actually part of template
		expect(result.prompt.endsWith("---\n")).toBe(true)
	})

	it("should use default reponame and filename if not available from vscode", () => {
		;(vscode.window.activeTextEditor as any) = undefined
		;(vscode.workspace.workspaceFolders as any) = undefined
		const mockTemplate: AutocompleteTemplate = {
			template: "File: {{{filename}}} Repo: {{{reponame}}}",
			completionOptions: {},
		}
		;(getTemplateForModel as jest.Mock).mockReturnValue(mockTemplate)

		const result = promptRenderer.renderPrompt(basicCodeContext, []) // Added empty array for snippets
		expect(result.prompt).toBe("File: untitled.txt Repo: my-repository")
	})

	describe("getStopTokens", () => {
		it("should call the utility function with correct parameters", () => {
			const mockTemplateForStop: AutocompleteTemplate = { template: "", completionOptions: { temperature: 0.5 } }
			;(getTemplateForModel as jest.Mock).mockReturnValue(mockTemplateForStop)
			;(getLanguageInfo as jest.Mock).mockReturnValue(mockPythonLangInfo)
			;(getStopTokens as jest.Mock).mockReturnValue(["CUSTOM_STOP"])

			const rendererWithOptions = new PromptRenderer({ language: "python" }, "custom-py-model")
			const stopTokens = rendererWithOptions.getStopTokens()

			expect(getTemplateForModel).toHaveBeenCalledWith("custom-py-model")
			expect(getLanguageInfo).toHaveBeenCalledWith("python")
			expect(getStopTokens).toHaveBeenCalledWith(
				mockTemplateForStop.completionOptions,
				mockPythonLangInfo,
				"custom-py-model",
			)
			expect(stopTokens).toEqual(["CUSTOM_STOP"])
		})
	})

	describe("extractCompletion", () => {
		it("should return trimmed response if no markdown", () => {
			const response = "  const x = 10;  "
			expect(promptRenderer.extractCompletion(response)).toBe("const x = 10;")
		})

		it("should extract content from markdown code block", () => {
			const response = '```typescript\nconst greeting = "hello";\nconsole.log(greeting);\n```'
			expect(promptRenderer.extractCompletion(response)).toBe('const greeting = "hello";\nconsole.log(greeting);')
		})

		it("should extract content from markdown code block without language", () => {
			const response = "```\nlet num = 42;\nnum++;\n```"
			expect(promptRenderer.extractCompletion(response)).toBe("let num = 42;\nnum++;")
		})

		it("should handle empty content in markdown block", () => {
			const response = "```javascript\n\n```"
			expect(promptRenderer.extractCompletion(response)).toBe("")
		})

		it("should trim content inside code block", () => {
			const response = '```\n  \n  let message = "  Hi  ";  \n  \n```'
			expect(promptRenderer.extractCompletion(response)).toBe('let message = "  Hi  ";')
		})
	})
})
