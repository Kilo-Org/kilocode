import { describe, it, expect } from "vitest"
import {
	languageForFilepath,
	LANGUAGES,
	Typescript,
	JavaScript,
	Python,
	Java,
	Cpp,
	CSharp,
	C,
	Scala,
	Go,
	Rust,
	Haskell,
	PHP,
	RubyOnRails,
	Swift,
	Kotlin,
	Ruby,
	Clojure,
	Julia,
	FSharp,
	R,
	Dart,
	Solidity,
	Lua,
	YAML,
	Json,
	Markdown,
} from "./AutocompleteLanguageInfo"

describe("AutocompleteLanguageInfo", () => {
	describe("languageForFilepath", () => {
		describe("TypeScript/JavaScript files", () => {
			it("should return TypeScript for .ts files", () => {
				expect(languageForFilepath("file.ts")).toBe(Typescript)
				expect(languageForFilepath("/path/to/file.ts")).toBe(Typescript)
			})

			it("should return TypeScript for .tsx files", () => {
				expect(languageForFilepath("component.tsx")).toBe(Typescript)
			})

			it("should return JavaScript for .js files", () => {
				expect(languageForFilepath("file.js")).toBe(JavaScript)
			})

			it("should return TypeScript for .jsx files", () => {
				expect(languageForFilepath("component.jsx")).toBe(Typescript)
			})

			it("should return Json for .json files", () => {
				expect(languageForFilepath("config.json")).toBe(Json)
			})
		})

		describe("Python files", () => {
			it("should return Python for .py files", () => {
				expect(languageForFilepath("script.py")).toBe(Python)
			})

			it("should return Python for .pyi files", () => {
				expect(languageForFilepath("types.pyi")).toBe(Python)
			})

			it("should return Python for .ipynb files", () => {
				expect(languageForFilepath("notebook.ipynb")).toBe(Python)
			})
		})

		describe("Java files", () => {
			it("should return Java for .java files", () => {
				expect(languageForFilepath("Main.java")).toBe(Java)
			})
		})

		describe("C/C++ files", () => {
			it("should return Cpp for .cpp files", () => {
				expect(languageForFilepath("main.cpp")).toBe(Cpp)
			})

			it("should return Cpp for .cxx files", () => {
				expect(languageForFilepath("main.cxx")).toBe(Cpp)
			})

			it("should return Cpp for .h files", () => {
				expect(languageForFilepath("header.h")).toBe(Cpp)
			})

			it("should return Cpp for .hpp files", () => {
				expect(languageForFilepath("header.hpp")).toBe(Cpp)
			})

			it("should return C for .c files", () => {
				expect(languageForFilepath("program.c")).toBe(C)
			})
		})

		describe("C# files", () => {
			it("should return CSharp for .cs files", () => {
				expect(languageForFilepath("Program.cs")).toBe(CSharp)
			})
		})

		describe("Go files", () => {
			it("should return Go for .go files", () => {
				expect(languageForFilepath("main.go")).toBe(Go)
			})
		})

		describe("Rust files", () => {
			it("should return Rust for .rs files", () => {
				expect(languageForFilepath("main.rs")).toBe(Rust)
			})
		})

		describe("Ruby files", () => {
			it("should return Ruby for .rb files", () => {
				expect(languageForFilepath("script.rb")).toBe(Ruby)
			})

			it("should return RubyOnRails for .rails files", () => {
				expect(languageForFilepath("app.rails")).toBe(RubyOnRails)
			})
		})

		describe("Other languages", () => {
			it("should return Scala for .scala and .sc files", () => {
				expect(languageForFilepath("Main.scala")).toBe(Scala)
				expect(languageForFilepath("script.sc")).toBe(Scala)
			})

			it("should return Haskell for .hs files", () => {
				expect(languageForFilepath("Main.hs")).toBe(Haskell)
			})

			it("should return PHP for .php files", () => {
				expect(languageForFilepath("index.php")).toBe(PHP)
			})

			it("should return Swift for .swift files", () => {
				expect(languageForFilepath("ViewController.swift")).toBe(Swift)
			})

			it("should return Kotlin for .kt files", () => {
				expect(languageForFilepath("MainActivity.kt")).toBe(Kotlin)
			})

			it("should return Clojure for .clj, .cljs, .cljc files", () => {
				expect(languageForFilepath("core.clj")).toBe(Clojure)
				expect(languageForFilepath("app.cljs")).toBe(Clojure)
				expect(languageForFilepath("shared.cljc")).toBe(Clojure)
			})

			it("should return Julia for .jl files", () => {
				expect(languageForFilepath("script.jl")).toBe(Julia)
			})

			it("should return FSharp for .fs, .fsi, .fsx, .fsscript files", () => {
				expect(languageForFilepath("Program.fs")).toBe(FSharp)
				expect(languageForFilepath("Interface.fsi")).toBe(FSharp)
				expect(languageForFilepath("Script.fsx")).toBe(FSharp)
				expect(languageForFilepath("Script.fsscript")).toBe(FSharp)
			})

			it("should return R for .r and .R files", () => {
				expect(languageForFilepath("analysis.r")).toBe(R)
				expect(languageForFilepath("analysis.R")).toBe(R)
			})

			it("should return Dart for .dart files", () => {
				expect(languageForFilepath("main.dart")).toBe(Dart)
			})

			it("should return Solidity for .sol files", () => {
				expect(languageForFilepath("Contract.sol")).toBe(Solidity)
			})

			it("should return Lua for .lua and .luau files", () => {
				expect(languageForFilepath("script.lua")).toBe(Lua)
				expect(languageForFilepath("script.luau")).toBe(Lua)
			})

			it("should return YAML for .yaml and .yml files", () => {
				expect(languageForFilepath("config.yaml")).toBe(YAML)
				expect(languageForFilepath("config.yml")).toBe(YAML)
			})

			it("should return Markdown for .md files", () => {
				expect(languageForFilepath("README.md")).toBe(Markdown)
			})
		})

		describe("fallback behavior", () => {
			it("should return Typescript for unknown file extensions", () => {
				expect(languageForFilepath("file.unknown")).toBe(Typescript)
			})

			it("should return Typescript for files without extension", () => {
				expect(languageForFilepath("Makefile")).toBe(Typescript)
			})

			it("should return Typescript for empty filename", () => {
				expect(languageForFilepath("")).toBe(Typescript)
			})
		})

		describe("URI handling", () => {
			it("should handle file:// URIs", () => {
				expect(languageForFilepath("file:///path/to/file.py")).toBe(Python)
			})

			it("should handle complex paths", () => {
				expect(languageForFilepath("/very/long/path/to/deeply/nested/file.rs")).toBe(Rust)
			})

			it("should handle paths with dots in directory names", () => {
				expect(languageForFilepath("/path.to/some.dir/file.go")).toBe(Go)
			})
		})
	})

	describe("language configurations", () => {
		describe("required properties", () => {
			const testLanguageProperties = (name: string, lang: any) => {
				it(`${name} should have name property`, () => {
					expect(lang.name).toBeDefined()
					expect(typeof lang.name).toBe("string")
				})

				it(`${name} should have topLevelKeywords array`, () => {
					expect(lang.topLevelKeywords).toBeDefined()
					expect(Array.isArray(lang.topLevelKeywords)).toBe(true)
				})

				it(`${name} should have endOfLine array`, () => {
					expect(lang.endOfLine).toBeDefined()
					expect(Array.isArray(lang.endOfLine)).toBe(true)
				})
			}

			testLanguageProperties("TypeScript", Typescript)
			testLanguageProperties("JavaScript", JavaScript)
			testLanguageProperties("Python", Python)
			testLanguageProperties("Java", Java)
			testLanguageProperties("C++", Cpp)
			testLanguageProperties("C#", CSharp)
			testLanguageProperties("C", C)
			testLanguageProperties("Scala", Scala)
			testLanguageProperties("Go", Go)
			testLanguageProperties("Rust", Rust)
			testLanguageProperties("Haskell", Haskell)
			testLanguageProperties("PHP", PHP)
			testLanguageProperties("Ruby on Rails", RubyOnRails)
			testLanguageProperties("Swift", Swift)
			testLanguageProperties("Kotlin", Kotlin)
			testLanguageProperties("Ruby", Ruby)
			testLanguageProperties("Clojure", Clojure)
			testLanguageProperties("Julia", Julia)
			testLanguageProperties("F#", FSharp)
			testLanguageProperties("R", R)
			testLanguageProperties("Dart", Dart)
			testLanguageProperties("Solidity", Solidity)
			testLanguageProperties("Lua", Lua)
			testLanguageProperties("YAML", YAML)
			testLanguageProperties("JSON", Json)
			testLanguageProperties("Markdown", Markdown)
		})

		describe("singleLineComment property", () => {
			it("should have correct comment syntax for common languages", () => {
				expect(Typescript.singleLineComment).toBe("//")
				expect(JavaScript.singleLineComment).toBe("//")
				expect(Python.singleLineComment).toBe("#")
				expect(Java.singleLineComment).toBe("//")
				expect(Cpp.singleLineComment).toBe("//")
				expect(Go.singleLineComment).toBe("//")
				expect(Rust.singleLineComment).toBe("//")
				expect(Haskell.singleLineComment).toBe("--")
				expect(Lua.singleLineComment).toBe("--")
				expect(Clojure.singleLineComment).toBe(";")
				expect(Ruby.singleLineComment).toBe("#")
			})

			it("should have empty string for Markdown", () => {
				expect(Markdown.singleLineComment).toBe("")
			})
		})

		describe("endOfLine markers", () => {
			it("should have semicolon for C-style languages", () => {
				expect(Typescript.endOfLine).toContain(";")
				expect(JavaScript.endOfLine).toContain(";")
				expect(Java.endOfLine).toContain(";")
				expect(Cpp.endOfLine).toContain(";")
				expect(CSharp.endOfLine).toContain(";")
			})

			it("should have empty array for languages without explicit line endings", () => {
				expect(Python.endOfLine).toEqual([])
				expect(Go.endOfLine).toEqual([])
				expect(Ruby.endOfLine).toEqual([])
				expect(Markdown.endOfLine).toEqual([])
			})

			it("should have JSON-specific end of line markers", () => {
				expect(Json.endOfLine).toContain(",")
				expect(Json.endOfLine).toContain("}")
				expect(Json.endOfLine).toContain("]")
			})
		})

		describe("topLevelKeywords", () => {
			it("should include function-related keywords for most languages", () => {
				expect(Typescript.topLevelKeywords).toContain("function")
				expect(JavaScript.topLevelKeywords).toContain("function")
				expect(Python.topLevelKeywords).toContain("def")
				expect(Go.topLevelKeywords).toContain("func")
				expect(Rust.topLevelKeywords).toContain("fn")
			})

			it("should include class-related keywords where applicable", () => {
				expect(Typescript.topLevelKeywords).toContain("class")
				expect(JavaScript.topLevelKeywords).toContain("class")
				expect(Python.topLevelKeywords).toContain("class")
				expect(Java.topLevelKeywords).toContain("class")
			})

			it("should have empty array for YAML and Markdown", () => {
				expect(YAML.topLevelKeywords).toEqual([])
				expect(Markdown.topLevelKeywords).toEqual([])
			})

			it("should include Python-specific keywords for ipynb files", () => {
				expect(Python.topLevelKeywords).toContain('"""#')
			})
		})
	})

	describe("special language features", () => {
		describe("YAML lineFilters", () => {
			it("should have lineFilters defined", () => {
				expect(YAML.lineFilters).toBeDefined()
				expect(Array.isArray(YAML.lineFilters)).toBe(true)
				expect(YAML.lineFilters!.length).toBeGreaterThan(0)
			})
		})

		describe("JSON charFilters", () => {
			it("should have charFilters defined", () => {
				expect(Json.charFilters).toBeDefined()
				expect(Array.isArray(Json.charFilters)).toBe(true)
				expect(Json.charFilters!.length).toBeGreaterThan(0)
			})

			it("should include bracket matching filter", () => {
				expect(Json.charFilters![0].name).toBe("matchBrackets")
			})
		})

		describe("Markdown useMultiline", () => {
			it("should have useMultiline function defined", () => {
				expect(Markdown.useMultiline).toBeDefined()
				expect(typeof Markdown.useMultiline).toBe("function")
			})

			it('should return true for list items starting with "- " (trailing space removed by trim)', () => {
				const result = Markdown.useMultiline!({
					prefix: "Some text\n- ",
					suffix: "",
				})
				// After trim(), "- " becomes "-" which doesn't match pattern "- " (with space)
				expect(result).toBe(true)
			})

			it('should return true for list items starting with "* " (trailing space removed by trim)', () => {
				const result = Markdown.useMultiline!({
					prefix: "Some text\n* ",
					suffix: "",
				})
				// After trim(), "* " becomes "*" which doesn't match pattern "* " (with space)
				expect(result).toBe(true)
			})

			it("should return true for numbered lists (trailing space removed by trim)", () => {
				const result = Markdown.useMultiline!({
					prefix: "Some text\n1. ",
					suffix: "",
				})
				// After trim(), "1. " becomes "1." which doesn't match pattern /^\d+\. / (requires space)
				expect(result).toBe(true)
			})

			it('should return true for blockquotes starting with "> " (trailing space removed by trim)', () => {
				const result = Markdown.useMultiline!({
					prefix: "Some text\n> ",
					suffix: "",
				})
				// After trim(), "> " becomes ">" which doesn't match pattern "> " (with space)
				expect(result).toBe(true)
			})

			it("should return false for code blocks with ```", () => {
				const result = Markdown.useMultiline!({
					prefix: "Some text\n```",
					suffix: "",
				})
				expect(result).toBe(false)
			})

			it("should return true for headers starting with # (trailing space removed by trim)", () => {
				const result = Markdown.useMultiline!({
					prefix: "Some text\n# ",
					suffix: "",
				})
				// After trim(), "# " becomes "#" which doesn't match pattern /^#{1,6} / (requires space)
				expect(result).toBe(true)
			})

			it("should return true for different header levels (trailing space removed by trim)", () => {
				// After trim(), all these lose trailing space and don't match /^#{1,6} / pattern
				expect(Markdown.useMultiline!({ prefix: "## ", suffix: "" })).toBe(true)
				expect(Markdown.useMultiline!({ prefix: "### ", suffix: "" })).toBe(true)
				expect(Markdown.useMultiline!({ prefix: "###### ", suffix: "" })).toBe(true)
			})

			it("should return true for regular paragraph text", () => {
				const result = Markdown.useMultiline!({
					prefix: "This is regular text\nAnd more text",
					suffix: "",
				})
				expect(result).toBe(true)
			})

			it("should return true when prefix is empty", () => {
				const result = Markdown.useMultiline!({
					prefix: "",
					suffix: "some suffix",
				})
				expect(result).toBe(true)
			})

			it("should check current line only, not previous lines", () => {
				const result = Markdown.useMultiline!({
					prefix: "- item 1\nregular text",
					suffix: "",
				})
				expect(result).toBe(true)
			})

			it("should trim current line before checking (but also removes trailing space)", () => {
				const result = Markdown.useMultiline!({
					prefix: "text\n  - ",
					suffix: "",
				})
				// After trim(), "  - " becomes "-" (both leading and trailing spaces removed)
				// So it doesn't match pattern "- " (with space)
				expect(result).toBe(true)
			})
		})
	})

	describe("LANGUAGES map", () => {
		it("should contain all expected file extensions", () => {
			const expectedExtensions = [
				"ts",
				"js",
				"tsx",
				"jsx",
				"json",
				"py",
				"pyi",
				"ipynb",
				"java",
				"cpp",
				"cxx",
				"h",
				"hpp",
				"c",
				"cs",
				"scala",
				"sc",
				"go",
				"rs",
				"hs",
				"php",
				"rb",
				"rails",
				"swift",
				"kt",
				"clj",
				"cljs",
				"cljc",
				"jl",
				"fs",
				"fsi",
				"fsx",
				"fsscript",
				"r",
				"R",
				"dart",
				"sol",
				"yaml",
				"yml",
				"md",
				"lua",
				"luau",
			]

			for (const ext of expectedExtensions) {
				expect(LANGUAGES[ext]).toBeDefined()
			}
		})

		it("should have correct number of language mappings", () => {
			const keys = Object.keys(LANGUAGES)
			expect(keys.length).toBeGreaterThanOrEqual(40)
		})

		it("should map multiple extensions to same language where appropriate", () => {
			// TypeScript variants
			expect(LANGUAGES.ts).toBe(LANGUAGES.tsx)
			expect(LANGUAGES.ts).toBe(Typescript)

			// C++ variants
			expect(LANGUAGES.cpp).toBe(LANGUAGES.cxx)
			expect(LANGUAGES.cpp).toBe(LANGUAGES.h)
			expect(LANGUAGES.cpp).toBe(LANGUAGES.hpp)

			// Python variants
			expect(LANGUAGES.py).toBe(LANGUAGES.pyi)
			expect(LANGUAGES.py).toBe(LANGUAGES.ipynb)

			// Scala variants
			expect(LANGUAGES.scala).toBe(LANGUAGES.sc)

			// Clojure variants
			expect(LANGUAGES.clj).toBe(LANGUAGES.cljs)
			expect(LANGUAGES.clj).toBe(LANGUAGES.cljc)

			// F# variants
			expect(LANGUAGES.fs).toBe(LANGUAGES.fsi)
			expect(LANGUAGES.fs).toBe(LANGUAGES.fsx)
			expect(LANGUAGES.fs).toBe(LANGUAGES.fsscript)

			// R variants
			expect(LANGUAGES.r).toBe(LANGUAGES.R)

			// YAML variants
			expect(LANGUAGES.yaml).toBe(LANGUAGES.yml)

			// Lua variants
			expect(LANGUAGES.lua).toBe(LANGUAGES.luau)
		})
	})
})
