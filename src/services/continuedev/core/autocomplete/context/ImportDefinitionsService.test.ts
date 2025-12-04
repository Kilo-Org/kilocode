import { beforeEach, describe, expect, it, vi } from "vitest"
import { IDE, RangeInFileWithContents } from "../.."
import { getAst } from "../util/ast"
import { ImportDefinitionsService } from "./ImportDefinitionsService"

// Only mock the IDE and uri utilities - NOT tree-sitter!
vi.mock("../../util/uri", () => ({
	findUriInDirs: vi.fn(() => ({ foundInDir: true })),
}))

describe("ImportDefinitionsService", () => {
	let mockIde: IDE
	let service: ImportDefinitionsService

	beforeEach(() => {
		// Create mock IDE with necessary methods
		mockIde = {
			readFile: vi.fn(),
			readRangeInFile: vi.fn(),
			gotoDefinition: vi.fn(),
			getWorkspaceDirs: vi.fn().mockResolvedValue(["/workspace"]),
			onDidChangeActiveTextEditor: vi.fn(),
		} as any

		service = new ImportDefinitionsService(mockIde)
	})

	describe("Python Imports - Real Tree-sitter Parsing", () => {
		it("should extract named imports from 'from module import' statements", async () => {
			const pythonCode = `from os.path import join, exists
from typing import List, Dict
import sys`

			const filepath = "/workspace/test.py"

			// Verify tree-sitter can actually parse this
			const ast = await getAst(filepath, pythonCode)
			expect(ast).toBeTruthy()
			expect(ast?.rootNode.type).toBe("module")

			// Mock IDE operations (NOT tree-sitter)
			;(mockIde.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(pythonCode)

			const mockDefinition: RangeInFileWithContents = {
				filepath: "/workspace/os/path.py",
				range: {
					start: { line: 10, character: 0 },
					end: { line: 15, character: 0 },
				},
				contents: "def join(*args): ...",
			}

			;(mockIde.gotoDefinition as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					filepath: mockDefinition.filepath,
					range: mockDefinition.range,
				},
			])
			;(mockIde.readRangeInFile as ReturnType<typeof vi.fn>).mockResolvedValue(mockDefinition.contents)

			const result = await (service as any)._getFileInfo(filepath)

			// Verify real tree-sitter found the imports
			expect(result).toBeTruthy()
			expect(result?.imports).toBeDefined()
			expect(result?.imports["join"]).toBeDefined()
			expect(result?.imports["exists"]).toBeDefined()
			expect(result?.imports["List"]).toBeDefined()
			expect(result?.imports["Dict"]).toBeDefined()
		})

		it("should NOT match imports in strings/comments (proves tree-sitter is used)", async () => {
			// This test PROVES tree-sitter is working, not regex
			const pythonCode = `from mymodule import MyClass

# This comment has "from fake import NotReal" but it's not code
text = "import something"
multiline = '''
from another import FakeImport
'''`

			const filepath = "/workspace/string_test.py"

			// Verify tree-sitter parses this correctly
			const ast = await getAst(filepath, pythonCode)
			expect(ast).toBeTruthy()

			// Find string nodes - tree-sitter should NOT match imports inside them
			const stringNodes = ast?.rootNode.descendantsOfType("string")
			expect(stringNodes?.length).toBeGreaterThan(0)
			;(mockIde.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(pythonCode)
			;(mockIde.gotoDefinition as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					filepath: "/workspace/mymodule.py",
					range: {
						start: { line: 0, character: 0 },
						end: { line: 10, character: 0 },
					},
				},
			])
			;(mockIde.readRangeInFile as ReturnType<typeof vi.fn>).mockResolvedValue("class MyClass: ...")

			const result = await (service as any)._getFileInfo(filepath)

			// Should ONLY find MyClass, NOT "NotReal", "something", or "FakeImport"
			expect(result?.imports["MyClass"]).toBeDefined()
			expect(result?.imports["NotReal"]).toBeUndefined()
			expect(result?.imports["something"]).toBeUndefined()
			expect(result?.imports["FakeImport"]).toBeUndefined()
		})

		it("should handle real Python AST structure for imports", async () => {
			const pythonCode = `from collections import defaultdict, Counter
import json`

			const filepath = "/workspace/collections_test.py"

			// Verify tree-sitter creates proper AST
			const ast = await getAst(filepath, pythonCode)
			expect(ast).toBeTruthy()

			// Verify we can find import_from_statement nodes
			const importNodes = ast?.rootNode.descendantsOfType("import_from_statement")
			expect(importNodes?.length).toBe(1)

			// Verify import_statement nodes
			const importStmts = ast?.rootNode.descendantsOfType("import_statement")
			expect(importStmts?.length).toBe(1)
			;(mockIde.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(pythonCode)
			;(mockIde.gotoDefinition as ReturnType<typeof vi.fn>).mockResolvedValue([])
			;(mockIde.readRangeInFile as ReturnType<typeof vi.fn>).mockResolvedValue("")

			const result = await (service as any)._getFileInfo(filepath)

			expect(result?.imports["defaultdict"]).toBeDefined()
			expect(result?.imports["Counter"]).toBeDefined()
			expect(result?.imports["json"]).toBeDefined()
		})
	})

	describe("TypeScript Imports - Real Tree-sitter Parsing", () => {
		it("should extract named imports from ES6 import statements", async () => {
			const tsCode = `import { Component, useState } from 'react';
import { helper, utils } from './utils';
import defaultExport from './module';`

			const filepath = "/workspace/test.ts"

			// Verify tree-sitter can parse TypeScript
			const ast = await getAst(filepath, tsCode)
			expect(ast).toBeTruthy()
			expect(ast?.rootNode.type).toBe("program")
			;(mockIde.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(tsCode)
			;(mockIde.gotoDefinition as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					filepath: "/workspace/react.ts",
					range: {
						start: { line: 0, character: 0 },
						end: { line: 5, character: 0 },
					},
				},
			])
			;(mockIde.readRangeInFile as ReturnType<typeof vi.fn>).mockResolvedValue("export const Component = ...")

			const result = await (service as any)._getFileInfo(filepath)

			expect(result?.imports["Component"]).toBeDefined()
			expect(result?.imports["useState"]).toBeDefined()
			expect(result?.imports["helper"]).toBeDefined()
			expect(result?.imports["utils"]).toBeDefined()
			expect(result?.imports["defaultExport"]).toBeDefined()
		})

		it("should NOT match import-like strings (proves tree-sitter works)", async () => {
			const tsCode = `import { realImport } from './module';

const code = "import { fakeImport } from 'fake'";
const template = \`
  // This looks like: import something
  but it's just a template literal
\`;`

			const filepath = "/workspace/string_imports.ts"

			// Verify tree-sitter correctly identifies string nodes
			const ast = await getAst(filepath, tsCode)
			expect(ast).toBeTruthy()

			const stringNodes = ast?.rootNode.descendantsOfType("string")
			const templateNodes = ast?.rootNode.descendantsOfType("template_string")
			expect((stringNodes?.length || 0) + (templateNodes?.length || 0)).toBeGreaterThan(0)
			;(mockIde.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(tsCode)
			;(mockIde.gotoDefinition as ReturnType<typeof vi.fn>).mockResolvedValue([
				{
					filepath: "/workspace/module.ts",
					range: {
						start: { line: 0, character: 0 },
						end: { line: 5, character: 0 },
					},
				},
			])
			;(mockIde.readRangeInFile as ReturnType<typeof vi.fn>).mockResolvedValue("export const realImport = ...")

			const result = await (service as any)._getFileInfo(filepath)

			// Should only find realImport, NOT fakeImport or something
			expect(result?.imports["realImport"]).toBeDefined()
			expect(result?.imports["fakeImport"]).toBeUndefined()
			expect(result?.imports["something"]).toBeUndefined()
		})

		it("should handle real TypeScript AST for complex imports", async () => {
			const tsCode = `import { useState, useEffect } from 'react';
import { ComponentType } from 'react';
import defaultExport from './module';`

			const filepath = "/workspace/complex.ts"

			// Verify tree-sitter parses TypeScript imports correctly
			const ast = await getAst(filepath, tsCode)
			expect(ast).toBeTruthy()

			// Should find import_statement nodes
			const importStatements = ast?.rootNode.descendantsOfType("import_statement")
			expect(importStatements?.length).toBe(3)
			;(mockIde.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(tsCode)
			;(mockIde.gotoDefinition as ReturnType<typeof vi.fn>).mockResolvedValue([])
			;(mockIde.readRangeInFile as ReturnType<typeof vi.fn>).mockResolvedValue("")

			const result = await (service as any)._getFileInfo(filepath)

			// Tree-sitter query captures named imports and default imports
			expect(result?.imports["useState"]).toBeDefined()
			expect(result?.imports["useEffect"]).toBeDefined()
			expect(result?.imports["ComponentType"]).toBeDefined()
			expect(result?.imports["defaultExport"]).toBeDefined()
		})
	})

	describe("Edge Cases with Real Parsing", () => {
		it("should return null for .ipynb files", async () => {
			const filepath = "/workspace/notebook.ipynb"
			const result = await (service as any)._getFileInfo(filepath)
			expect(result).toBeNull()
		})

		it("should handle files with no imports", async () => {
			const pythonCode = `def hello():
    print("Hello, World!")`

			const filepath = "/workspace/no_imports.py"

			// Verify tree-sitter still parses it
			const ast = await getAst(filepath, pythonCode)
			expect(ast).toBeTruthy()
			;(mockIde.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(pythonCode)

			const result = await (service as any)._getFileInfo(filepath)

			expect(result).toEqual({ imports: {} })
		})

		it("should handle syntax errors gracefully", async () => {
			const badCode = `import { incomplete from`

			const filepath = "/workspace/bad_syntax.ts"

			// Tree-sitter should still parse (with error nodes)
			const ast = await getAst(filepath, badCode)
			expect(ast).toBeTruthy() // tree-sitter is resilient
			;(mockIde.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(badCode)

			const result = await (service as any)._getFileInfo(filepath)

			// Should not crash, just return empty or partial results
			expect(result).toBeDefined()
		})

		it("should handle nested imports in code blocks", async () => {
			// Python with conditional import - tree-sitter should still find it
			const pythonCode = `if True:
    from typing import Optional
    
def func():
    import json
    return json`

			const filepath = "/workspace/nested.py"

			const ast = await getAst(filepath, pythonCode)
			expect(ast).toBeTruthy()
			;(mockIde.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(pythonCode)
			;(mockIde.gotoDefinition as ReturnType<typeof vi.fn>).mockResolvedValue([])
			;(mockIde.readRangeInFile as ReturnType<typeof vi.fn>).mockResolvedValue("")

			const result = await (service as any)._getFileInfo(filepath)

			// Tree-sitter should find imports even in nested contexts
			expect(result?.imports["Optional"]).toBeDefined()
			expect(result?.imports["json"]).toBeDefined()
		})
	})

	describe("Verify Tree-sitter Dependency", () => {
		it("should fail if tree-sitter cannot parse TypeScript", async () => {
			const filepath = "/workspace/test.unknown"
			const code = "import { test } from 'module';"

			// This should fail because tree-sitter doesn't support .unknown extension
			const ast = await getAst(filepath, code)
			expect(ast).toBeUndefined()
			;(mockIde.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(code)

			const result = await (service as any)._getFileInfo(filepath)

			// Should return empty imports because no parser available
			expect(result).toEqual({ imports: {} })
		})

		it("should use real tree-sitter parser for Python", async () => {
			const pythonCode = `from package import module`
			const filepath = "/workspace/verify.py"

			// This MUST use real tree-sitter parser
			const ast = await getAst(filepath, pythonCode)
			expect(ast).toBeTruthy()
			expect(ast?.rootNode.type).toBe("module")

			// Verify we get actual Python syntax nodes
			const importFrom = ast?.rootNode.descendantsOfType("import_from_statement")
			expect(importFrom?.length).toBeGreaterThan(0)
		})

		it("should use real tree-sitter parser for TypeScript", async () => {
			const tsCode = `import { Component } from 'react';`
			const filepath = "/workspace/verify.ts"

			// This MUST use real tree-sitter parser
			const ast = await getAst(filepath, tsCode)
			expect(ast).toBeTruthy()
			expect(ast?.rootNode.type).toBe("program")

			// Verify we get actual TypeScript import nodes
			const imports = ast?.rootNode.descendantsOfType("import_statement")
			expect(imports?.length).toBeGreaterThan(0)
		})
	})

	describe("Direct Tree-sitter Query Tests", () => {
		describe("Python Import Queries", () => {
			it("should find dotted_name nodes in from imports", async () => {
				const code = `from os.path import join`
				const tree = await getAst("test.py", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				// Tree-sitter should parse dotted names correctly
				const dottedNames = tree.rootNode.descendantsOfType("dotted_name")
				expect(dottedNames.length).toBeGreaterThan(0)

				// Verify the dotted name structure
				const osPath = dottedNames.find((n) => n && n.text === "os.path")
				expect(osPath).toBeTruthy()
			})

			it("should distinguish import names from module paths", async () => {
				const code = `from collections import defaultdict, Counter`
				const tree = await getAst("test.py", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				// The imported names should be captured separately from the module
				const importFromStmt = tree.rootNode.descendantsOfType("import_from_statement")[0]
				expect(importFromStmt).toBeTruthy()
				if (!importFromStmt) return

				// Find the actual imported names (not the module name)
				const allIdentifiers = importFromStmt.descendantsOfType("dotted_name")
				const texts = allIdentifiers.map((n) => n && n.text).filter(Boolean)

				// Should include the imported names
				expect(texts.some((t) => t && (t === "defaultdict" || t.includes("defaultdict")))).toBe(true)
				expect(texts.some((t) => t && (t === "Counter" || t.includes("Counter")))).toBe(true)
			})

			it("should handle aliased imports", async () => {
				const code = `import numpy as np\nfrom typing import List as ListType`
				const tree = await getAst("test.py", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				// Should find both import types
				const importStmts = tree.rootNode.descendantsOfType("import_statement")
				const importFromStmts = tree.rootNode.descendantsOfType("import_from_statement")

				expect(importStmts.length).toBeGreaterThan(0)
				expect(importFromStmts.length).toBeGreaterThan(0)

				// Verify alias nodes exist
				const aliasedImport = tree.rootNode.descendantsOfType("aliased_import")
				expect(aliasedImport.length).toBeGreaterThan(0)
			})

			it("should find wildcard imports", async () => {
				const code = `from module import *`
				const tree = await getAst("test.py", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				const importFromStmt = tree.rootNode.descendantsOfType("import_from_statement")[0]
				expect(importFromStmt).toBeTruthy()

				// Should have a wildcard import node
				const wildcardImport = tree.rootNode.descendantsOfType("wildcard_import")
				expect(wildcardImport.length).toBeGreaterThan(0)
			})

			it("should handle relative imports", async () => {
				const code = `from . import helper\nfrom ..utils import config`
				const tree = await getAst("test.py", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				const importFromStmts = tree.rootNode.descendantsOfType("import_from_statement")
				expect(importFromStmts.length).toBe(2)

				// Verify relative import prefix
				const relativeImport = tree.rootNode.descendantsOfType("relative_import")
				expect(relativeImport.length).toBeGreaterThan(0)
			})
		})

		describe("TypeScript Import Queries", () => {
			it("should find named imports in import specifiers", async () => {
				const code = `import { useState, useEffect } from 'react';`
				const tree = await getAst("test.ts", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				// Should find import specifier nodes
				const importSpecifiers = tree.rootNode.descendantsOfType("import_specifier")
				expect(importSpecifiers.length).toBe(2)

				// Verify the names
				const names = importSpecifiers.map((spec) => {
					if (!spec) return undefined
					const identifier = spec.childForFieldName("name")
					return identifier?.text
				})
				expect(names).toContain("useState")
				expect(names).toContain("useEffect")
			})

			it("should handle default imports", async () => {
				const code = `import React from 'react';`
				const tree = await getAst("test.ts", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				const importStatement = tree.rootNode.descendantsOfType("import_statement")[0]
				expect(importStatement).toBeTruthy()
				if (!importStatement) return

				// Should find identifier for default import
				const identifiers = importStatement.descendantsOfType("identifier")
				expect(identifiers.some((id) => id && id.text === "React")).toBe(true)
			})

			it("should handle namespace imports", async () => {
				const code = `import * as Utils from './utils';`
				const tree = await getAst("test.ts", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				const importStatement = tree.rootNode.descendantsOfType("import_statement")[0]
				expect(importStatement).toBeTruthy()

				// Should find namespace import
				const namespaceImport = tree.rootNode.descendantsOfType("namespace_import")
				expect(namespaceImport.length).toBeGreaterThan(0)
				if (!namespaceImport[0]) return

				// Verify the alias name
				const identifiers = namespaceImport[0].descendantsOfType("identifier")
				expect(identifiers.some((id) => id && id.text === "Utils")).toBe(true)
			})

			it("should handle side-effect imports", async () => {
				const code = `import './styles.css';`
				const tree = await getAst("test.ts", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				const importStatement = tree.rootNode.descendantsOfType("import_statement")[0]
				expect(importStatement).toBeTruthy()
				if (!importStatement) return

				// Should have string literal for the path
				const strings = importStatement.descendantsOfType("string")
				expect(strings.length).toBeGreaterThan(0)
			})

			it("should handle mixed imports", async () => {
				const code = `import React, { Component, useState } from 'react';`
				const tree = await getAst("test.ts", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				const importStatement = tree.rootNode.descendantsOfType("import_statement")[0]
				expect(importStatement).toBeTruthy()
				if (!importStatement) return

				// Should have both default and named imports
				const importSpecifiers = importStatement.descendantsOfType("import_specifier")
				expect(importSpecifiers.length).toBe(2) // Component and useState

				// Should also have the default import identifier
				const allIdentifiers = importStatement.descendantsOfType("identifier")
				expect(allIdentifiers.some((id) => id && id.text === "React")).toBe(true)
			})

			it("should handle import aliases", async () => {
				const code = `import { LongName as Short } from './module';`
				const tree = await getAst("test.ts", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				const importSpecifier = tree.rootNode.descendantsOfType("import_specifier")[0]
				expect(importSpecifier).toBeTruthy()
				if (!importSpecifier) return

				// Should find both the original and alias names
				const nameField = importSpecifier.childForFieldName("name")
				const aliasField = importSpecifier.childForFieldName("alias")

				expect(nameField?.text).toBe("LongName")
				expect(aliasField?.text).toBe("Short")
			})
		})

		describe("Java Import Queries", () => {
			it("should find Java import declarations", async () => {
				const code = `import java.util.List;
import java.util.ArrayList;
import static java.lang.Math.PI;`
				const tree = await getAst("test.java", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				// Should find import declarations
				const importDecls = tree.rootNode.descendantsOfType("import_declaration")
				expect(importDecls.length).toBe(3)

				// Check for static import
				const staticImports = importDecls.filter((decl) => decl && decl.text.includes("static"))
				expect(staticImports.length).toBe(1)
			})

			it("should find scoped identifiers in Java imports", async () => {
				const code = `import com.example.project.MyClass;`
				const tree = await getAst("test.java", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				const importDecl = tree.rootNode.descendantsOfType("import_declaration")[0]
				expect(importDecl).toBeTruthy()
				if (!importDecl) return

				// Should have scoped identifier for the full path
				const scopedId = importDecl.descendantsOfType("scoped_identifier")
				expect(scopedId.length).toBeGreaterThan(0)
			})

			it("should handle wildcard Java imports", async () => {
				const code = `import java.util.*;`
				const tree = await getAst("test.java", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				const importDecl = tree.rootNode.descendantsOfType("import_declaration")[0]
				expect(importDecl).toBeTruthy()
				if (!importDecl) return

				// Should contain asterisk for wildcard
				const asterisk = importDecl.descendantsOfType("asterisk")
				expect(asterisk.length).toBeGreaterThan(0)
			})
		})

		describe("C++ Include Queries", () => {
			it("should find C++ include directives", async () => {
				const code = `#include <iostream>
#include "myheader.h"`
				const tree = await getAst("test.cpp", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				// Should find preproc_include nodes
				const includes = tree.rootNode.descendantsOfType("preproc_include")
				expect(includes.length).toBe(2)
			})

			it("should distinguish system vs local includes", async () => {
				const code = `#include <vector>
#include "local.h"`
				const tree = await getAst("test.cpp", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				const includes = tree.rootNode.descendantsOfType("preproc_include")
				expect(includes.length).toBe(2)

				// System include uses <>
				const systemInclude = includes.find((inc) => inc && inc.text.includes("<"))
				expect(systemInclude).toBeTruthy()
				expect(systemInclude?.text).toContain("vector")

				// Local include uses ""
				const localInclude = includes.find((inc) => inc && inc.text.includes('"'))
				expect(localInclude).toBeTruthy()
				expect(localInclude?.text).toContain("local.h")
			})
		})

		describe("Query Edge Cases", () => {
			it("should handle empty files", async () => {
				const code = ``
				const tree = await getAst("test.ts", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				// Should parse successfully with no import statements
				const imports = tree.rootNode.descendantsOfType("import_statement")
				expect(imports.length).toBe(0)
			})

			it("should handle files with only comments", async () => {
				const code = `// This is a comment
/* Multi-line
   comment */`
				const tree = await getAst("test.ts", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				const imports = tree.rootNode.descendantsOfType("import_statement")
				expect(imports.length).toBe(0)

				// Should parse comments
				const comments = tree.rootNode.descendantsOfType("comment")
				expect(comments.length).toBeGreaterThan(0)
			})

			it("should handle syntax errors in imports gracefully", async () => {
				const code = `import { incomplete`
				const tree = await getAst("test.ts", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				// Tree-sitter is resilient and should still create a tree
				// Either has errors or parsed what it could - both are acceptable
				expect(tree).toBeTruthy()
			})

			it("should handle very long import statements", async () => {
				const imports = Array.from({ length: 50 }, (_, i) => `import${i}`).join(", ")
				const code = `import { ${imports} } from 'large-module';`
				const tree = await getAst("test.ts", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				const importStatement = tree.rootNode.descendantsOfType("import_statement")[0]
				expect(importStatement).toBeTruthy()
				if (!importStatement) return

				const importSpecifiers = importStatement.descendantsOfType("import_specifier")
				expect(importSpecifiers.length).toBe(50)
			})

			it("should handle multiline imports", async () => {
				const code = `import {
  Component,
  useState,
  useEffect
} from 'react';`
				const tree = await getAst("test.ts", code)

				expect(tree).toBeTruthy()
				if (!tree) return

				const importSpecifiers = tree.rootNode.descendantsOfType("import_specifier")
				expect(importSpecifiers.length).toBe(3)
			})
		})
	})
})
