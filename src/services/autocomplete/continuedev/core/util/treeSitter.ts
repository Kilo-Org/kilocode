import fs from "node:fs"
import path from "path"

import type { Language, Node as SyntaxNode, Query, Tree } from "web-tree-sitter"
import { SymbolWithRange } from ".."
import { getUriFileExtension } from "./uri"

export enum LanguageName {
	CPP = "cpp",
	C_SHARP = "c_sharp",
	C = "c",
	CSS = "css",
	PHP = "php",
	BASH = "bash",
	JSON = "json",
	TYPESCRIPT = "typescript",
	TSX = "tsx",
	ELM = "elm",
	JAVASCRIPT = "javascript",
	PYTHON = "python",
	ELISP = "elisp",
	ELIXIR = "elixir",
	GO = "go",
	EMBEDDED_TEMPLATE = "embedded_template",
	HTML = "html",
	JAVA = "java",
	LUA = "lua",
	OCAML = "ocaml",
	QL = "ql",
	RESCRIPT = "rescript",
	RUBY = "ruby",
	RUST = "rust",
	SYSTEMRDL = "systemrdl",
	TOML = "toml",
	SOLIDITY = "solidity",
}

const supportedLanguages: { [key: string]: LanguageName } = {
	cpp: LanguageName.CPP,
	hpp: LanguageName.CPP,
	cc: LanguageName.CPP,
	cxx: LanguageName.CPP,
	hxx: LanguageName.CPP,
	cp: LanguageName.CPP,
	hh: LanguageName.CPP,
	inc: LanguageName.CPP,
	// Depended on this PR: https://github.com/tree-sitter/tree-sitter-cpp/pull/173
	// ccm: LanguageName.CPP,
	// c++m: LanguageName.CPP,
	// cppm: LanguageName.CPP,
	// cxxm: LanguageName.CPP,
	cs: LanguageName.C_SHARP,
	c: LanguageName.C,
	h: LanguageName.C,
	css: LanguageName.CSS,
	php: LanguageName.PHP,
	phtml: LanguageName.PHP,
	php3: LanguageName.PHP,
	php4: LanguageName.PHP,
	php5: LanguageName.PHP,
	php7: LanguageName.PHP,
	phps: LanguageName.PHP,
	"php-s": LanguageName.PHP,
	bash: LanguageName.BASH,
	sh: LanguageName.BASH,
	json: LanguageName.JSON,
	ts: LanguageName.TYPESCRIPT,
	mts: LanguageName.TYPESCRIPT,
	cts: LanguageName.TYPESCRIPT,
	tsx: LanguageName.TSX,
	// vue: LanguageName.VUE,  // tree-sitter-vue parser is broken
	// The .wasm file being used is faulty, and yaml is split line-by-line anyway for the most part
	// yaml: LanguageName.YAML,
	// yml: LanguageName.YAML,
	elm: LanguageName.ELM,
	js: LanguageName.JAVASCRIPT,
	jsx: LanguageName.JAVASCRIPT,
	mjs: LanguageName.JAVASCRIPT,
	cjs: LanguageName.JAVASCRIPT,
	py: LanguageName.PYTHON,
	// ipynb: LanguageName.PYTHON, // It contains Python, but the file format is a ton of JSON.
	pyw: LanguageName.PYTHON,
	pyi: LanguageName.PYTHON,
	el: LanguageName.ELISP,
	emacs: LanguageName.ELISP,
	ex: LanguageName.ELIXIR,
	exs: LanguageName.ELIXIR,
	go: LanguageName.GO,
	eex: LanguageName.EMBEDDED_TEMPLATE,
	heex: LanguageName.EMBEDDED_TEMPLATE,
	leex: LanguageName.EMBEDDED_TEMPLATE,
	html: LanguageName.HTML,
	htm: LanguageName.HTML,
	java: LanguageName.JAVA,
	lua: LanguageName.LUA,
	luau: LanguageName.LUA,
	ocaml: LanguageName.OCAML,
	ml: LanguageName.OCAML,
	mli: LanguageName.OCAML,
	ql: LanguageName.QL,
	res: LanguageName.RESCRIPT,
	resi: LanguageName.RESCRIPT,
	rb: LanguageName.RUBY,
	erb: LanguageName.RUBY,
	rs: LanguageName.RUST,
	rdl: LanguageName.SYSTEMRDL,
	toml: LanguageName.TOML,
	sol: LanguageName.SOLIDITY,

	// jl: LanguageName.JULIA,
	// swift: LanguageName.SWIFT,
	// kt: LanguageName.KOTLIN,
	// scala: LanguageName.SCALA,
}

export const IGNORE_PATH_PATTERNS: Partial<Record<LanguageName, RegExp[]>> = {
	[LanguageName.TYPESCRIPT]: [/.*node_modules/],
	[LanguageName.JAVASCRIPT]: [/.*node_modules/],
}

export async function getParserForFile(filepath: string) {
	try {
		// Dynamically import Parser to avoid issues with WASM loading
		const { Parser } = require("web-tree-sitter")

		await Parser.init()
		const parser = new Parser()

		const language = await getLanguageForFile(filepath)
		if (!language) {
			return undefined
		}

		parser.setLanguage(language)

		return parser
	} catch (e) {
		console.error("Unable to load language for file", filepath, e)
		return undefined
	}
}

// Helper function to find the first existing path from a list of candidates
function findExistingPath(candidatePaths: string[]): string | undefined {
	for (const p of candidatePaths) {
		if (fs.existsSync(p)) {
			return p
		}
	}
	return undefined
}

// Loading the wasm files to create a Language object is an expensive operation and with
// sufficient number of files can result in errors, instead keep a map of language name
// to Language object
const nameToLanguage = new Map<string, Language>()

function getExtensionFromPathOrUri(input: string): string {
	// Treat inputs with a scheme as URIs; otherwise as local filesystem paths
	if (input.includes("://") || input.startsWith("file:")) {
		return getUriFileExtension(input)
	}
	const base = path.basename(input)
	const dot = base.lastIndexOf(".")
	return dot >= 0 ? base.slice(dot + 1).toLowerCase() : ""
}

async function getLanguageForFile(filepathOrUri: string): Promise<Language | undefined> {
	try {
		const extension = getExtensionFromPathOrUri(filepathOrUri)

		const languageName = supportedLanguages[extension]
		if (!languageName) {
			return undefined
		}
		let language = nameToLanguage.get(languageName)

		if (!language) {
			language = await loadLanguageForFileExt(extension)
			nameToLanguage.set(languageName, language)
		}
		return language
	} catch (e) {
		console.debug("Unable to load language for file", filepathOrUri, e)
		return undefined
	}
}

export const getFullLanguageName = (filepathOrUri: string) => {
	const extension = getExtensionFromPathOrUri(filepathOrUri)
	return supportedLanguages[extension]
}

export async function getQueryForFile(filepathOrUri: string, queryPath: string): Promise<Query | undefined> {
	const language = await getLanguageForFile(filepathOrUri)
	if (!language) {
		return undefined
	}

	// Resolve the query file from tree-sitter directory.
	// The tree-sitter directory is at src/services/autocomplete/continuedev/tree-sitter/
	const repoRoot = path.resolve(__dirname, "..", "..", "..", "..", "..")

	const candidatePaths: string[] = [
		// Development: from src/services/autocomplete/continuedev/core/util -> src/services/autocomplete/continuedev/tree-sitter
		path.join(__dirname, "..", "..", "tree-sitter", queryPath),
		// Production: tree-sitter might be copied alongside compiled code
		path.join(__dirname, "tree-sitter", queryPath),
		// Alternative: from repo root
		path.join(repoRoot, "src", "services", "autocomplete", "continuedev", "tree-sitter", queryPath),
		// Fallback: dist directory
		path.join(repoRoot, "dist", "tree-sitter", queryPath),
	]

	const sourcePath = findExistingPath(candidatePaths)

	if (!sourcePath) {
		return undefined
	}

	const querySource = fs.readFileSync(sourcePath).toString()
	return language.query(querySource)
}

async function loadLanguageForFileExt(fileExtension: string): Promise<Language> {
	// Dynamically import Language to avoid issues with WASM loading
	const { Language } = require("web-tree-sitter")

	const filename = `tree-sitter-${supportedLanguages[fileExtension]}.wasm`
	const repoRoot = path.resolve(__dirname, "..", "..", "..", "..", "..")

	// The WASM files are copied to src/dist/ during build
	// In production (compiled): __dirname = /path/to/kilocode/src/dist or dist/
	// In development: __dirname = /path/to/kilocode/src/services/autocomplete/continuedev/core/util
	const candidatePaths: string[] = [
		// Production: WASM files are in the same directory as the compiled code
		path.join(__dirname, filename),
		// Development: from src/services/autocomplete/continuedev/core/util -> src/dist
		path.join(repoRoot, "dist", filename),
		// Fallback: repo root
		path.join(repoRoot, filename),
		// Legacy: node_modules location (fallback for older setups)
		path.join(repoRoot, "src", "node_modules", "tree-sitter-wasms", "out", filename),
	]

	const wasmPath = findExistingPath(candidatePaths)

	if (!wasmPath) {
		console.error(`Could not find ${filename}. Tried paths:`, candidatePaths)
		throw new Error(`Could not find language WASM file: ${filename}`)
	}

	return await Language.load(wasmPath)
}

// See https://tree-sitter.github.io/tree-sitter/using-parsers
const GET_SYMBOLS_FOR_NODE_TYPES: SyntaxNode["type"][] = [
	"class_declaration",
	"class_definition",
	"function_item", // function name = first "identifier" child
	"function_definition",
	"method_declaration", // method name = first "identifier" child
	"method_definition",
	"generator_function_declaration",
	// property_identifier
	// field_declaration
	// "arrow_function",
]

export async function getSymbolsForFile(filepath: string, contents: string): Promise<SymbolWithRange[] | undefined> {
	//MINIMAL_REPO - continue doesn't use this in autocomplete
	const parser = await getParserForFile(filepath)
	if (!parser) {
		return
	}

	let tree: Tree | null
	try {
		tree = parser.parse(contents)
	} catch {
		console.log(`Error parsing file: ${filepath}`)
		return
	}

	if (!tree) {
		console.log(`Failed to parse file: ${filepath}`)
		return
	}
	// console.log(`file: ${filepath}`);

	// Function to recursively find all named nodes (classes and functions)
	const symbols: SymbolWithRange[] = []
	function findNamedNodesRecursive(node: SyntaxNode) {
		// console.log(`node: ${node.type}, ${node.text}`);
		if (GET_SYMBOLS_FOR_NODE_TYPES.includes(node.type)) {
			// console.log(`parent: ${node.type}, ${node.text.substring(0, 200)}`);
			// node.children.forEach((child) => {
			//   console.log(`child: ${child.type}, ${child.text}`);
			// });

			// Empirically, the actual name is the last identifier in the node
			// Especially with languages where return type is declared before the name
			// TODO use findLast in newer version of node target
			let identifier: SyntaxNode | undefined = undefined
			for (let i = node.children.length - 1; i >= 0; i--) {
				const child = node.children[i]
				if (child && (child.type === "identifier" || child.type === "property_identifier")) {
					identifier = child
					break
				}
			}

			if (identifier?.text) {
				symbols.push({
					filepath,
					type: node.type,
					name: identifier.text,
					range: {
						start: {
							character: node.startPosition.column,
							line: node.startPosition.row,
						},
						end: {
							character: node.endPosition.column + 1,
							line: node.endPosition.row + 1,
						},
					},
					content: node.text,
				})
			}
		}
		node.children.forEach((child) => {
			if (child) findNamedNodesRecursive(child)
		})
	}
	findNamedNodesRecursive(tree.rootNode)
	return symbols
}
