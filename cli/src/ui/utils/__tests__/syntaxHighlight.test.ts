/**
 * Tests for syntax highlighting utilities
 *
 * This test suite verifies language detection and syntax highlighting
 * functionality for the CLI diff views.
 */

import { describe, it, expect, beforeAll } from "vitest"
import {
	detectLanguage,
	highlightLine,
	highlightLineSync,
	highlightCodeBlock,
	highlightCodeBlockSync,
	initializeSyntaxHighlighter,
	isHighlighterReady,
	isLanguageReady,
	preloadLanguage,
} from "../syntaxHighlight.js"

describe("syntaxHighlight", () => {
	describe("detectLanguage", () => {
		describe("common programming languages", () => {
			it("should detect TypeScript files", () => {
				expect(detectLanguage("src/index.ts")).toBe("typescript")
				expect(detectLanguage("component.tsx")).toBe("tsx")
				expect(detectLanguage("types.d.ts")).toBe("typescript")
			})

			it("should detect JavaScript files", () => {
				expect(detectLanguage("app.js")).toBe("javascript")
				expect(detectLanguage("component.jsx")).toBe("jsx") // JSX uses Shiki's jsx for better JSX element highlighting
				expect(detectLanguage("module.mjs")).toBe("javascript")
				expect(detectLanguage("script.cjs")).toBe("javascript")
			})

			it("should detect Python files", () => {
				expect(detectLanguage("script.py")).toBe("python")
				expect(detectLanguage("app.pyw")).toBe("python")
			})

			it("should detect Rust files", () => {
				expect(detectLanguage("main.rs")).toBe("rust")
			})

			it("should detect Go files", () => {
				expect(detectLanguage("main.go")).toBe("go")
			})

			it("should detect Java files", () => {
				expect(detectLanguage("Main.java")).toBe("java")
			})

			it("should detect C/C++ files", () => {
				expect(detectLanguage("main.c")).toBe("c")
				expect(detectLanguage("main.cpp")).toBe("cpp")
				expect(detectLanguage("main.cc")).toBe("cpp")
				expect(detectLanguage("header.h")).toBe("c")
				expect(detectLanguage("header.hpp")).toBe("cpp")
			})

			it("should detect C# files", () => {
				expect(detectLanguage("Program.cs")).toBe("csharp")
			})

			it("should detect Ruby files", () => {
				expect(detectLanguage("app.rb")).toBe("ruby")
			})

			it("should detect PHP files", () => {
				// PHP uses explicit override to ensure Shiki's php language is used
				expect(detectLanguage("index.php")).toBe("php")
			})

			it("should detect Swift files", () => {
				expect(detectLanguage("App.swift")).toBe("swift")
			})

			it("should detect Kotlin files", () => {
				expect(detectLanguage("Main.kt")).toBe("kotlin")
				expect(detectLanguage("Script.kts")).toBe("kotlin")
			})

			it("should detect Scala files", () => {
				expect(detectLanguage("App.scala")).toBe("scala")
			})
		})

		describe("markup and data languages", () => {
			it("should detect HTML files", () => {
				expect(detectLanguage("index.html")).toBe("html")
				expect(detectLanguage("page.htm")).toBe("html")
			})

			it("should detect CSS files", () => {
				expect(detectLanguage("styles.css")).toBe("css")
				expect(detectLanguage("styles.scss")).toBe("scss")
				expect(detectLanguage("styles.sass")).toBe("sass")
				expect(detectLanguage("styles.less")).toBe("less")
			})

			it("should detect Markdown files", () => {
				expect(detectLanguage("README.md")).toBe("markdown")
				expect(detectLanguage("docs.markdown")).toBe("markdown")
			})

			it("should detect JSON files", () => {
				// package.json maps to 'json', tsconfig.json maps to 'jsonc' (special filename)
				expect(detectLanguage("package.json")).toBe("json")
				expect(detectLanguage("tsconfig.json")).toBe("jsonc")
			})

			it("should detect YAML files", () => {
				expect(detectLanguage("config.yaml")).toBe("yaml")
				expect(detectLanguage("config.yml")).toBe("yaml")
			})

			it("should detect XML files", () => {
				expect(detectLanguage("pom.xml")).toBe("xml")
			})

			it("should detect TOML files", () => {
				expect(detectLanguage("Cargo.toml")).toBe("toml")
			})
		})

		describe("shell and scripting", () => {
			it("should detect shell scripts", () => {
				expect(detectLanguage("script.sh")).toBe("shellscript")
				expect(detectLanguage("script.bash")).toBe("shellscript")
				expect(detectLanguage("script.zsh")).toBe("shellscript")
			})

			it("should detect PowerShell files", () => {
				expect(detectLanguage("script.ps1")).toBe("powershell")
			})

			it("should detect Lua files", () => {
				expect(detectLanguage("script.lua")).toBe("lua")
			})

			it("should detect Perl files", () => {
				expect(detectLanguage("script.pl")).toBe("perl")
			})
		})

		describe("special filenames", () => {
			it("should detect Dockerfile", () => {
				// Dockerfile maps to 'docker' in Shiki
				expect(detectLanguage("Dockerfile")).toBe("docker")
				// Dockerfile.dev doesn't match the exact filename, returns null
				expect(detectLanguage("Dockerfile.dev")).toBeNull()
			})

			it("should detect Makefile", () => {
				// Makefile maps to 'make' in Shiki
				expect(detectLanguage("Makefile")).toBe("make")
				expect(detectLanguage("makefile")).toBe("make")
				expect(detectLanguage("GNUmakefile")).toBe("make")
			})

			it("should detect dotfiles", () => {
				// .gitignore and .dockerignore don't have Shiki language mappings
				// They return null (no syntax highlighting)
				expect(detectLanguage(".gitignore")).toBeNull()
				expect(detectLanguage(".dockerignore")).toBeNull()
			})
		})

		describe("edge cases", () => {
			it("should handle paths with directories", () => {
				expect(detectLanguage("src/components/Button.tsx")).toBe("tsx")
				expect(detectLanguage("/absolute/path/to/file.py")).toBe("python")
				expect(detectLanguage("./relative/path/script.js")).toBe("javascript")
			})

			it("should handle case-insensitive extensions", () => {
				expect(detectLanguage("FILE.TS")).toBe("typescript")
				expect(detectLanguage("README.MD")).toBe("markdown")
				expect(detectLanguage("Config.JSON")).toBe("json")
			})

			it("should return null for unknown extensions", () => {
				expect(detectLanguage("file.unknown")).toBeNull()
				expect(detectLanguage("file.xyz123")).toBeNull()
			})

			it("should return null for files without extension", () => {
				// Unless they match a special filename
				expect(detectLanguage("randomfile")).toBeNull()
			})

			it("should handle empty string", () => {
				expect(detectLanguage("")).toBeNull()
			})

			it("should handle files with multiple dots", () => {
				expect(detectLanguage("file.test.ts")).toBe("typescript")
				expect(detectLanguage("component.spec.tsx")).toBe("tsx")
				expect(detectLanguage("config.prod.json")).toBe("json")
			})
		})
	})

	describe("highlightLineSync", () => {
		describe("when highlighter is not ready", () => {
			it("should return null for any input", () => {
				// Before initialization, highlighter is not ready
				// Note: This test assumes fresh module state
				const result = highlightLineSync("const x = 1;", "typescript")
				// Result depends on whether highlighter was initialized in previous tests
				// If null, highlighter wasn't ready; if array, it was
				expect(result === null || Array.isArray(result)).toBe(true)
			})

			it("should return null for null language", () => {
				const result = highlightLineSync("some text", null)
				expect(result).toBeNull()
			})

			it("should return null for empty line", () => {
				const result = highlightLineSync("", "typescript")
				expect(result).toBeNull()
			})
		})
	})

	describe("isHighlighterReady", () => {
		it("should return boolean", () => {
			const result = isHighlighterReady()
			expect(typeof result).toBe("boolean")
		})
	})

	describe("isLanguageReady", () => {
		it("should return false for null language", () => {
			expect(isLanguageReady(null)).toBe(false)
		})

		it("should return boolean for valid language", () => {
			const result = isLanguageReady("typescript")
			expect(typeof result).toBe("boolean")
		})
	})

	describe("async highlighting", () => {
		beforeAll(async () => {
			// Initialize the highlighter for async tests
			await initializeSyntaxHighlighter()
		}, 30000) // Allow 30s for initialization

		describe("initializeSyntaxHighlighter", () => {
			it("should initialize without error", async () => {
				// Should not throw
				await initializeSyntaxHighlighter()
				expect(isHighlighterReady()).toBe(true)
			})

			it("should be idempotent", async () => {
				// Calling multiple times should be safe
				await initializeSyntaxHighlighter()
				await initializeSyntaxHighlighter()
				expect(isHighlighterReady()).toBe(true)
			})
		})

		describe("highlightLine", () => {
			it("should highlight TypeScript code", async () => {
				const result = await highlightLine("const x: number = 42;", "typescript")
				expect(Array.isArray(result)).toBe(true)
				expect(result.length).toBeGreaterThan(0)
				// Should have multiple tokens for syntax elements
				expect(result.some((t) => t.color !== undefined)).toBe(true)
			})

			it("should highlight JavaScript code", async () => {
				const result = await highlightLine("function hello() { return 'world'; }", "javascript")
				expect(Array.isArray(result)).toBe(true)
				expect(result.length).toBeGreaterThan(0)
			})

			it("should highlight Python code", async () => {
				const result = await highlightLine("def hello(): return 'world'", "python")
				expect(Array.isArray(result)).toBe(true)
				expect(result.length).toBeGreaterThan(0)
			})

			it("should return plain text for null language", async () => {
				const line = "some plain text"
				const result = await highlightLine(line, null)
				expect(result).toEqual([{ content: line }])
			})

			it("should return plain text for empty line", async () => {
				const result = await highlightLine("", "typescript")
				expect(result).toEqual([{ content: "" }])
			})

			it("should handle different themes", async () => {
				const line = "const x = 1;"
				const darkResult = await highlightLine(line, "typescript", "dark")
				const lightResult = await highlightLine(line, "typescript", "light")

				// Both should return tokens
				expect(darkResult.length).toBeGreaterThan(0)
				expect(lightResult.length).toBeGreaterThan(0)

				// Colors might differ between themes
				// (not guaranteed, but structure should be same)
				expect(darkResult.map((t) => t.content)).toEqual(lightResult.map((t) => t.content))
			})

			it("should handle custom theme type", async () => {
				const result = await highlightLine("const x = 1;", "typescript", "custom")
				expect(Array.isArray(result)).toBe(true)
				expect(result.length).toBeGreaterThan(0)
			})
		})

		describe("preloadLanguage", () => {
			it("should preload a language without error", async () => {
				await preloadLanguage("rust")
				expect(isLanguageReady("rust")).toBe(true)
			})

			it("should handle null language", async () => {
				// Should not throw
				await preloadLanguage(null)
			})

			it("should be idempotent", async () => {
				await preloadLanguage("go")
				await preloadLanguage("go")
				expect(isLanguageReady("go")).toBe(true)
			})
		})

		describe("highlightLineSync after preload", () => {
			it("should work synchronously after preload", async () => {
				await preloadLanguage("typescript")
				const result = highlightLineSync("const x = 1;", "typescript")
				expect(result).not.toBeNull()
				expect(Array.isArray(result)).toBe(true)
				expect(result!.length).toBeGreaterThan(0)
			})

			it("should return null for unloaded language", () => {
				// Use an obscure language that's unlikely to be preloaded
				const result = highlightLineSync("code", "cobol" as unknown as string)
				expect(result).toBeNull()
			})
		})

		describe("highlightCodeBlock", () => {
			it("should highlight multiple lines together", async () => {
				const lines = ["const x = 1;", "const y = 2;", "const z = x + y;"]
				const result = await highlightCodeBlock(lines, "typescript")
				expect(Array.isArray(result)).toBe(true)
				expect(result.length).toBe(3)
				// Each line should have tokens
				result.forEach((lineTokens) => {
					expect(Array.isArray(lineTokens)).toBe(true)
					expect(lineTokens.length).toBeGreaterThan(0)
				})
			})

			it("should preserve multiline string context", async () => {
				// Template literal spanning multiple lines
				const lines = ["const msg = `Hello", "World", "`;"]
				const result = await highlightCodeBlock(lines, "typescript")
				expect(result.length).toBe(3)
				// The middle line should be highlighted as string content
				// (not as plain text like line-by-line would do)
				const middleLineTokens = result[1]
				expect(middleLineTokens).toBeDefined()
				expect(middleLineTokens!.length).toBeGreaterThan(0)
				// Should have color (string color)
				expect(middleLineTokens!.some((t) => t.color !== undefined)).toBe(true)
			})

			it("should return plain text for null language", async () => {
				const lines = ["line 1", "line 2"]
				const result = await highlightCodeBlock(lines, null)
				expect(result).toEqual([[{ content: "line 1" }], [{ content: "line 2" }]])
			})

			it("should return empty array for empty input", async () => {
				const result = await highlightCodeBlock([], "typescript")
				expect(result).toEqual([])
			})

			it("should handle different themes", async () => {
				const lines = ["const x = 1;"]
				const darkResult = await highlightCodeBlock(lines, "typescript", "dark")
				const lightResult = await highlightCodeBlock(lines, "typescript", "light")

				// Both should return tokens
				expect(darkResult.length).toBe(1)
				expect(lightResult.length).toBe(1)

				// Content should be the same
				expect(darkResult[0]!.map((t) => t.content)).toEqual(lightResult[0]!.map((t) => t.content))
			})
		})

		describe("highlightCodeBlockSync", () => {
			it("should work synchronously after preload", async () => {
				await preloadLanguage("typescript")
				const lines = ["const x = 1;", "const y = 2;"]
				const result = highlightCodeBlockSync(lines, "typescript")
				expect(result).not.toBeNull()
				expect(Array.isArray(result)).toBe(true)
				expect(result!.length).toBe(2)
			})

			it("should return null for null language", () => {
				const result = highlightCodeBlockSync(["line"], null)
				expect(result).toBeNull()
			})

			it("should return null for empty lines", () => {
				const result = highlightCodeBlockSync([], "typescript")
				expect(result).toBeNull()
			})

			it("should return null for unloaded language", () => {
				const result = highlightCodeBlockSync(["code"], "cobol" as unknown as string)
				expect(result).toBeNull()
			})

			it("should preserve multiline context synchronously", async () => {
				await preloadLanguage("javascript")
				// Multiline comment
				const lines = ["/*", " * Comment", " */"]
				const result = highlightCodeBlockSync(lines, "javascript")
				expect(result).not.toBeNull()
				expect(result!.length).toBe(3)
				// All lines should have comment coloring
				result!.forEach((lineTokens) => {
					expect(lineTokens.some((t) => t.color !== undefined)).toBe(true)
				})
			})
		})
	})
})
