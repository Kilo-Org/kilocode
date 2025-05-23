import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { ContextGatherer, type CodeContextDefinition as _CodeContextDefinition } from "../ContextGatherer"
import { type AutocompleteLanguageInfo as _AutocompleteLanguageInfo } from "../AutocompleteLanguageInfo"
import type Parser from "web-tree-sitter"

// Define mocks first
const mockVscode = {
	commands: {
		executeCommand: jest.fn(),
	},
	workspace: {
		fs: {
			readFile: jest.fn(),
		},
		getConfiguration: jest.fn(() => ({
			get: jest.fn(),
		})),
		onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
		// Add other necessary workspace mocks if needed by ContextGatherer constructor or methods
	},
	window: {
		onDidChangeTextEditorSelection: jest.fn(() => ({ dispose: jest.fn() })),
		// Add other necessary window mocks
	},
	Uri: {
		file: jest.fn((filePath: string) => {
			const _path = filePath // to avoid confusion with path module
			return {
				scheme: "file",
				authority: "",
				path: _path,
				query: "",
				fragment: "",
				fsPath: _path,
				with: jest.fn().mockReturnThis(), // basic mock for 'with'
				toJSON: jest.fn(() => ({ scheme: "file", fsPath: _path, path: _path })),
				toString: jest.fn(() => `file://${_path}`),
			}
		}),
		parse: jest.fn((uriString: string) => {
			const parts = uriString.replace("file://", "").split("#")
			const _path = parts[0]
			return {
				scheme: "file",
				authority: "",
				path: _path,
				query: "",
				fragment: parts[1] || "",
				fsPath: _path,
				with: jest.fn().mockReturnThis(),
				toJSON: jest.fn(() => ({ scheme: "file", fsPath: _path, path: _path })),
				toString: jest.fn(() => uriString),
			}
		}),
	},
	Position: jest.fn((line: number, character: number) => ({ line, character })),
	Range: jest.fn((start: vscode.Position, end: vscode.Position) => ({ start, end })),
	Location: jest.fn((uri: vscode.Uri, rangeOrPosition: vscode.Range | vscode.Position) => ({
		uri,
		range: rangeOrPosition as vscode.Range /* simplified for mock */,
	})),
	// Add other VS Code constructs as needed
}

// Mock VS Code APIs
jest.mock("vscode", () => mockVscode)

// Mock tree-sitter utilities
const mockTreeSitterUtils = {
	getAst: jest.fn(),
	getTreePathAtCursor: jest.fn(),
}
jest.mock("../utils/treeSitter", () => mockTreeSitterUtils)

const FIXTURES_PATH = path.join(__dirname, "fixtures", "contextGatherer")

// Helper to read fixture files
const readFixtureFile = (filePath: string): string => {
	return fs.readFileSync(path.join(FIXTURES_PATH, filePath), "utf-8")
}

interface MockSyntaxNode {
	type: string
	text: string
	startPosition: { row: number; column: number }
	endPosition: { row: number; column: number }
	parent?: MockSyntaxNode | null
	children: MockSyntaxNode[]
	// Add other fields if ContextGatherer uses them
}

interface LspInteractionExpectation {
	identifierTextInSource: string
	identifierPositionInSource: vscode.Position // Position of this identifier in the source file
	lspShouldReturnDefinitionAt: vscode.Location // What executeDefinitionProvider should return
	definitionFileContentFixture: string // Fixture name for content of the definition file
	expectedFinalSnippet: string // Snippet text expected in CodeContextDefinition (after truncation)
	expectedFinalFilepath: string // Expected filepath in CodeContextDefinition
	expectedFinalRange: vscode.Range // Expected range in CodeContextDefinition
}

interface LspTestCase {
	description: string
	fileName: string // Source file relative to FIXTURES_PATH
	cursorPositionForGatherContext: vscode.Position // Cursor in source file for the main gatherContext call
	language: string // Mainly for description
	expectedLspInteractions: LspInteractionExpectation[]
	// Mocks for tree-sitter for this specific case
	treeSitterPreambleNodes?: MockSyntaxNode[] // Nodes before the cursor path (e.g. imports)
	treeSitterCursorPathNodes: MockSyntaxNode[] // Nodes forming the path to the cursor
}

const PYTHON_CLASSES_BASECLASS_PERSON_CASE: LspTestCase = {
	description: "Finds BaseClass and Person definitions for class Group(BaseClass, Person):",
	fileName: "python/classes.py",
	cursorPositionForGatherContext: new vscode.Position(0, 13), // Inside "BaseClass"
	language: "Python",
	treeSitterCursorPathNodes: [
		// Simplified: path leads to "BaseClass" identifier
		{
			// Root node (simplified)
			type: "module",
			text: readFixtureFile("python/classes.py"),
			startPosition: { row: 0, column: 0 },
			endPosition: { row: 10, column: 9 },
			children: [
				{
					// class_definition for Group
					type: "class_definition",
					text: "class Group(BaseClass, Person):",
					startPosition: { row: 0, column: 0 },
					endPosition: { row: 1, column: 8 },
					children: [
						{
							type: "identifier",
							text: "Group",
							startPosition: { row: 0, column: 6 },
							endPosition: { row: 0, column: 11 },
							children: [],
							parent: null,
						},
						{
							// argument_list
							type: "argument_list",
							text: "(BaseClass, Person)",
							startPosition: { row: 0, column: 11 },
							endPosition: { row: 0, column: 30 },
							children: [
								{
									type: "identifier",
									text: "BaseClass",
									startPosition: { row: 0, column: 12 },
									endPosition: { row: 0, column: 21 },
									children: [],
									parent: null,
								}, // Node for BaseClass
								{
									type: "identifier",
									text: "Person",
									startPosition: { row: 0, column: 23 },
									endPosition: { row: 0, column: 29 },
									children: [],
									parent: null,
								}, // Node for Person
							],
							parent: null,
						},
					],
					parent: null,
				},
			],
			parent: null,
		},
		// Path to BaseClass identifier node (as per cursorPositionForGatherContext)
		{
			type: "class_definition",
			text: "class Group(BaseClass, Person):",
			startPosition: { row: 0, column: 0 },
			endPosition: { row: 1, column: 8 },
			children: [
				/*...*/
			],
			parent: null,
		},
		{
			type: "argument_list",
			text: "(BaseClass, Person)",
			startPosition: { row: 0, column: 11 },
			endPosition: { row: 0, column: 30 },
			children: [
				/*...*/
			],
			parent: null,
		},
		{
			type: "identifier",
			text: "BaseClass",
			startPosition: { row: 0, column: 12 },
			endPosition: { row: 0, column: 21 },
			children: [],
			parent: null,
		},
	],
	expectedLspInteractions: [
		{
			identifierTextInSource: "BaseClass",
			identifierPositionInSource: new vscode.Position(0, 12), // Start of "BaseClass"
			lspShouldReturnDefinitionAt: new vscode.Location(
				mockVscode.Uri.file(path.join(FIXTURES_PATH, "base_module.py")),
				// Range of the full "class BaseClass:..." definition in base_module.py
				new vscode.Range(new vscode.Position(2, 0), new vscode.Position(5, 33)),
			),
			definitionFileContentFixture: "base_module.py",
			// Expected snippet after ContextGatherer's truncation logic
			expectedFinalSnippet: 'class BaseClass:\n    def __init__(self):\n        print("BaseClass initialized")',
			expectedFinalFilepath: mockVscode.Uri.file(path.join(FIXTURES_PATH, "base_module.py")).toString(),
			expectedFinalRange: new vscode.Range(new vscode.Position(2, 0), new vscode.Position(5, 33)),
		},
		// When _crawlTypesLsp runs on Person (if BaseClass def doesn't contain Person or if it's a sibling)
		// This part of the test case needs to be carefully constructed based on how _crawlTypesLsp and _getDefinitionsForNodeLsp interact.
		// For now, let's assume the primary definition for "Person" is also found from the main file scan.
		{
			identifierTextInSource: "Person", // Assuming "Person" is also processed from the class Group line
			identifierPositionInSource: new vscode.Position(0, 23), // Start of "Person"
			lspShouldReturnDefinitionAt: new vscode.Location(
				mockVscode.Uri.file(path.join(FIXTURES_PATH, "base_module.py")),
				new vscode.Range(new vscode.Position(19, 0), new vscode.Position(25, 46)),
			),
			definitionFileContentFixture: "base_module.py",
			expectedFinalSnippet:
				"class Person:\n    def __init__(self, name: str, address: Address):\n// ...body omitted...", // Example if truncated
			expectedFinalFilepath: mockVscode.Uri.file(path.join(FIXTURES_PATH, "base_module.py")).toString(),
			expectedFinalRange: new vscode.Range(new vscode.Position(19, 0), new vscode.Position(25, 46)),
		},
	],
}

const PYTHON_TEST_CASES: LspTestCase[] = [PYTHON_CLASSES_BASECLASS_PERSON_CASE]
// Add more test cases here

async function testGatherContextForLspDefinitions(contextGatherer: ContextGatherer, testCase: LspTestCase) {
	const sourceFileContent = readFixtureFile(testCase.fileName)
	const sourceFileUri = mockVscode.Uri.file(path.join(FIXTURES_PATH, testCase.fileName))

	// --- Mock vscode.workspace.fs.readFile ---
	;(mockVscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
		if (uri.fsPath === sourceFileUri.fsPath) {
			return Buffer.from(sourceFileContent)
		}
		// Find if this URI matches any of the definition files we expect to read
		const interaction = testCase.expectedLspInteractions.find(
			(interaction) => interaction.lspShouldReturnDefinitionAt.uri.fsPath === uri.fsPath,
		)
		if (interaction) {
			const defFileContent = readFixtureFile(interaction.definitionFileContentFixture)
			return Buffer.from(defFileContent)
		}
		console.warn(`[Test Mock readFile] Unhandled read for: ${uri.fsPath}`)
		return Buffer.from("")
	})

	// --- Mock vscode.commands.executeCommand (LSP Definition Provider) ---
	;(mockVscode.commands.executeCommand as jest.Mock).mockImplementation(
		async (command: string, uri: vscode.Uri, position: vscode.Position) => {
			if (command === "vscode.executeDefinitionProvider") {
				const matchingInteraction = testCase.expectedLspInteractions.find(
					(interaction) =>
						uri.fsPath === sourceFileUri.fsPath && // LSP call is for the source file
						position.line === interaction.identifierPositionInSource.line &&
						position.character === interaction.identifierPositionInSource.character,
				)
				if (matchingInteraction) {
					return [matchingInteraction.lspShouldReturnDefinitionAt] // Return as array
				}
			}
			return [] // Default no definitions
		},
	)

	// --- Mock treeSitterUtils.getAst ---
	;(mockTreeSitterUtils.getAst as jest.Mock).mockImplementation(async (filePath: string, content: string) => {
		// Return a mock AST. For simplicity, the root node is the first node in treeSitterCursorPathNodes.
		// A more robust mock would parse `content` or use pre-defined ASTs for each fixture.
		const rootNodeFromCase = testCase.treeSitterCursorPathNodes[0]
		if (filePath === sourceFileUri.toString() && content === sourceFileContent) {
			return { rootNode: rootNodeFromCase } as unknown as Parser.Tree
		}
		// Mock ASTs for definition files if _crawlTypesLsp needs them
		const interaction = testCase.expectedLspInteractions.find(
			(interaction) => interaction.lspShouldReturnDefinitionAt.uri.toString() === filePath,
		)
		if (interaction) {
			// Simplified AST for definition files, just enough for truncation logic perhaps
			const defContent = readFixtureFile(interaction.definitionFileContentFixture)
			if (content === defContent) {
				return {
					rootNode: {
						type: "module",
						text: content,
						children: [],
						startPosition: { row: 0, column: 0 },
						endPosition: { row: defContent.split("\n").length, column: 0 },
					},
				} as unknown as Parser.Tree
			}
		}
		console.warn(`[Test Mock getAst] Unhandled AST request for: ${filePath}`)
		return {
			rootNode: {
				type: "module",
				text: content,
				children: [],
				startPosition: { row: 0, column: 0 },
				endPosition: { row: 0, column: 0 },
			},
		} as unknown as Parser.Tree // Default empty AST
	})

	// --- Mock treeSitterUtils.getTreePathAtCursor ---
	;(mockTreeSitterUtils.getTreePathAtCursor as jest.Mock).mockImplementation(
		async (ast: Parser.Tree, _cursorIndex: number) => {
			// Check if the provided AST matches the one we'd expect for the source file
			if (ast.rootNode === testCase.treeSitterCursorPathNodes[0]) {
				return testCase.treeSitterCursorPathNodes as unknown as Parser.SyntaxNode[]
			}
			console.warn(`[Test Mock getTreePathAtCursor] AST mismatch or unhandled case.`)
			return []
		},
	)

	const mockDocument = {
		uri: sourceFileUri,
		getText: () => sourceFileContent,
		positionAt: (offset: number) => {
			// A slightly better mock
			let line = 0,
				char = 0
			for (let i = 0; i < offset; ++i) {
				if (sourceFileContent[i] === "\n") {
					line++
					char = 0
				} else {
					char++
				}
			}
			return new mockVscode.Position(line, char)
		},
		offsetAt: (position: vscode.Position) => {
			// A slightly better mock
			const lines = sourceFileContent.split("\n")
			let offset = 0
			for (let i = 0; i < position.line; ++i) offset += lines[i].length + 1
			offset += position.character
			return offset
		},
		lineCount: sourceFileContent.split("\n").length,
		languageId: testCase.language.toLowerCase(), // Needed for langInfo potentially
	} as unknown as vscode.TextDocument

	// --- Call gatherContext ---
	const codeContext = await contextGatherer.gatherContext(
		mockDocument,
		testCase.cursorPositionForGatherContext,
		false, // useImports = false
		true, // useDefinitions = true
	)

	// --- Assertions ---
	expect(codeContext.definitions).toBeDefined()
	// console.log("Gathered definitions:", JSON.stringify(codeContext.definitions, null, 2));

	for (const expectedInteraction of testCase.expectedLspInteractions) {
		const foundDefinition = codeContext.definitions.find(
			(def) =>
				def.filepath === expectedInteraction.expectedFinalFilepath &&
				def.range.start.line === expectedInteraction.expectedFinalRange.start.line &&
				def.range.start.character === expectedInteraction.expectedFinalRange.start.character &&
				def.range.end.line === expectedInteraction.expectedFinalRange.end.line &&
				def.range.end.character === expectedInteraction.expectedFinalRange.end.character,
		)

		expect(foundDefinition).toBeDefined()
		if (foundDefinition) {
			expect(foundDefinition.content.trim()).toBe(expectedInteraction.expectedFinalSnippet.trim())
			expect(foundDefinition.source).toBe("lsp")
		}

		// Verify executeCommand was called for this identifier
		expect(mockVscode.commands.executeCommand).toHaveBeenCalledWith(
			"vscode.executeDefinitionProvider",
			sourceFileUri,
			expectedInteraction.identifierPositionInSource,
		)
	}
	// Ensure no unexpected definitions were added from LSP for this focused test
	const lspDefinitions = codeContext.definitions.filter((d) => d.source === "lsp")
	expect(lspDefinitions.length).toBe(testCase.expectedLspInteractions.length)
}

describe("ContextGatherer - LSP Definition Crawling", () => {
	let contextGatherer: ContextGatherer

	beforeEach(() => {
		contextGatherer = new ContextGatherer(20, 10, 10, 5) // Use some default values
		// Reset mocks before each test
		;(mockVscode.commands.executeCommand as jest.Mock).mockClear()
		;(mockVscode.workspace.fs.readFile as jest.Mock).mockClear()
		;(mockTreeSitterUtils.getAst as jest.Mock).mockClear()
		;(mockTreeSitterUtils.getTreePathAtCursor as jest.Mock).mockClear()
		// Ensure Uri.file mock is reset
		mockVscode.Uri.file = jest.fn((filePath: string) => {
			const _path = filePath
			return {
				scheme: "file",
				authority: "",
				path: _path,
				query: "",
				fragment: "",
				fsPath: _path,
				with: jest.fn().mockReturnThis(),
				toJSON: jest.fn(() => ({ scheme: "file", fsPath: _path, path: _path })),
				toString: jest.fn(() => `file://${_path}`),
			}
		})
	})

	describe.each(PYTHON_TEST_CASES)("$language: $fileName - $description", (testCase) => {
		test("should find correct type definitions via LSP", async () => {
			await testGatherContextForLspDefinitions(contextGatherer, testCase)
		})
	})

	// Add similar describe.each for TYPESCRIPT_TEST_CASES, etc.
	// e.g. const TYPESCRIPT_TEST_CASES: LspTestCase[] = [ /* ... test cases ... */ ];
	// describe.each(TYPESCRIPT_TEST_CASES) ( ... )
})

// TODO: Add tests for other ContextGatherer functionalities:
// - Recently Edited Context
// - Recently Visited Context
// - Import Extraction
// - Overall gatherContext method (more complex scenarios combining sources)
