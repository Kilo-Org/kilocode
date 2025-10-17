import * as vscode from "vscode"
import { isCommentLine, extractComment, cleanComment } from "../CommentHelpers"
import { MockTextDocument } from "../../../mocking/MockTextDocument"

describe("CommentHelpers", () => {
	describe("isCommentLine", () => {
		describe("empty and whitespace-only comments", () => {
			test("should reject single-line comment with only syntax", () => {
				expect(isCommentLine("//", "javascript")).toBe(false)
			})

			test("should reject single-line comment with only whitespace", () => {
				expect(isCommentLine("//   ", "javascript")).toBe(false)
				expect(isCommentLine("#   ", "python")).toBe(false)
			})

			test("should reject structural multi-line comment markers without content", () => {
				expect(isCommentLine("/*", "javascript")).toBe(false)
				expect(isCommentLine("<!--", "html")).toBe(false)
			})

			test("should reject asterisk-only line (inside block comment)", () => {
				expect(isCommentLine("*", "javascript")).toBe(false)
			})

			test("should accept multi-line comment with content", () => {
				expect(isCommentLine("/* content", "javascript")).toBe(true)
				expect(isCommentLine("* content", "javascript")).toBe(true)
				expect(isCommentLine("<!-- content", "html")).toBe(true)
			})

			test("should reject non-structural multi-line with only whitespace", () => {
				expect(isCommentLine("*   ", "javascript")).toBe(false)
			})
		})

		describe("JavaScript/TypeScript comments", () => {
			test("should recognize single-line comments with content", () => {
				expect(isCommentLine("// TODO: fix this", "javascript")).toBe(true)
				expect(isCommentLine("//TODO: fix this", "javascript")).toBe(true)
			})

			test("should recognize block comment start", () => {
				expect(isCommentLine("/* comment", "javascript")).toBe(true)
			})

			test("should recognize block comment continuation", () => {
				expect(isCommentLine("* comment", "javascript")).toBe(true)
			})

			test("should work with TypeScript", () => {
				expect(isCommentLine("// comment", "typescript")).toBe(true)
				expect(isCommentLine("/* comment", "typescriptreact")).toBe(true)
			})
		})

		describe("Python comments", () => {
			test("should recognize hash comments", () => {
				expect(isCommentLine("# comment", "python")).toBe(true)
			})

			test("should recognize docstring markers", () => {
				expect(isCommentLine('"""', "python")).toBe(false)
				expect(isCommentLine("'''", "python")).toBe(false)
				expect(isCommentLine('""" docstring', "python")).toBe(true)
				expect(isCommentLine("''' docstring", "python")).toBe(true)
			})

			test("should handle empty hash comment", () => {
				expect(isCommentLine("#", "python")).toBe(false)
			})
		})

		describe("HTML/XML comments", () => {
			test("should recognize HTML comment markers", () => {
				expect(isCommentLine("<!--", "xml")).toBe(false)
				expect(isCommentLine("<!-- comment", "html")).toBe(true)
			})
		})

		describe("CSS comments", () => {
			test("should recognize CSS block comments", () => {
				expect(isCommentLine("/* comment", "css")).toBe(true)
				expect(isCommentLine("* comment", "scss")).toBe(true)
			})

			test("should recognize single-line comments even in CSS (permissive)", () => {
				// Permissive: recognize // even in CSS (could be from preprocessor or embedded JS)
				expect(isCommentLine("// not a comment", "css")).toBe(true)
			})
		})

		describe("SQL comments", () => {
			test("should recognize SQL line comments", () => {
				expect(isCommentLine("-- comment", "sql")).toBe(true)
			})

			test("should reject empty SQL comment", () => {
				expect(isCommentLine("--", "sql")).toBe(false)
			})
		})

		describe("other languages", () => {
			test("should recognize Lisp semicolon comments", () => {
				expect(isCommentLine("; comment", "lisp")).toBe(true)
			})

			test("should recognize MATLAB percent comments", () => {
				expect(isCommentLine("% comment", "matlab")).toBe(true)
			})

			test("should recognize VB single quote comments", () => {
				expect(isCommentLine("' comment", "vb")).toBe(true)
			})
		})

		describe("edge cases", () => {
			test("should handle lines with leading whitespace", () => {
				expect(isCommentLine("  // comment", "javascript")).toBe(true)
				expect(isCommentLine("\t# comment", "python")).toBe(true)
			})

			test("should handle mixed comment syntax not matching language", () => {
				expect(isCommentLine("// comment", "python")).toBe(true)
				expect(isCommentLine("# comment", "javascript")).toBe(true)
			})

			test("should reject non-comment lines", () => {
				expect(isCommentLine("const x = 1", "javascript")).toBe(false)
				expect(isCommentLine("x = 1", "python")).toBe(false)
			})

			test("should handle unknown language IDs", () => {
				expect(isCommentLine("// comment", "unknown")).toBe(true)
				expect(isCommentLine("# comment", "unknown")).toBe(true)
			})
		})
	})

	describe("extractComment", () => {
		function createDocument(content: string, languageId: string = "javascript"): MockTextDocument {
			const uri = vscode.Uri.file("/test.js")
			const doc = new MockTextDocument(uri, content)
			doc.languageId = languageId
			return doc
		}

		describe("single line comments", () => {
			test("should extract comment from current line", () => {
				const doc = createDocument("// comment\nconst x = 1")
				expect(extractComment(doc, 0)).toBe("// comment")
			})

			test("should extract comment from previous line if current is not a comment", () => {
				const doc = createDocument("// comment\nconst x = 1")
				expect(extractComment(doc, 1)).toBe("// comment")
			})

			test("should return empty string if no comment found", () => {
				const doc = createDocument("const x = 1\nconst y = 2")
				expect(extractComment(doc, 1)).toBe("")
			})

			test("should not look at previous line if current line is first line", () => {
				const doc = createDocument("const x = 1")
				expect(extractComment(doc, 0)).toBe("")
			})
		})

		describe("multi-line comments", () => {
			test("should extract multi-line comment above current line", () => {
				const doc = createDocument("// line 1\n// line 2\n// line 3\nconst x = 1")
				const result = extractComment(doc, 2)
				expect(result).toBe("// line 1\n// line 2\n// line 3")
			})

			test("should extract multi-line comment below current line", () => {
				const doc = createDocument("// line 1\n// line 2\n// line 3\nconst x = 1")
				const result = extractComment(doc, 0)
				expect(result).toBe("// line 1\n// line 2\n// line 3")
			})

			test("should extract multi-line comment with cursor in middle", () => {
				const doc = createDocument("// line 1\n// line 2\n// line 3\nconst x = 1")
				const result = extractComment(doc, 1)
				expect(result).toBe("// line 1\n// line 2\n// line 3")
			})

			test("should handle block comment style", () => {
				const doc = createDocument("/*\n * line 1\n * line 2\n */\nconst x = 1")
				const result = extractComment(doc, 1)
				expect(result).toBe("* line 1\n* line 2\n*/")
			})
		})

		describe("Python docstrings", () => {
			test("should not extract empty Python docstring markers", () => {
				const doc = createDocument('"""\n"""\n"""\ndef foo():', "python")
				const result = extractComment(doc, 0)
				expect(result).toBe("")
			})
		})

		describe("edge cases", () => {
			test("should handle document with only one line", () => {
				const doc = createDocument("// comment")
				expect(extractComment(doc, 0)).toBe("// comment")
			})

			test("should handle comment at end of document", () => {
				const doc = createDocument("const x = 1\n// comment")
				expect(extractComment(doc, 1)).toBe("// comment")
			})

			test("should stop at non-comment line", () => {
				const doc = createDocument("// comment 1\nconst x = 1\n// comment 2")
				expect(extractComment(doc, 0)).toBe("// comment 1")
			})

			test("should handle whitespace-only lines between comments", () => {
				const doc = createDocument("// comment 1\n   \n// comment 2")
				expect(extractComment(doc, 0)).toBe("// comment 1")
			})

			test("should preserve trimmed line content", () => {
				const doc = createDocument("  // indented comment  \nconst x = 1")
				expect(extractComment(doc, 0)).toBe("// indented comment")
			})
		})
	})

	describe("cleanComment", () => {
		describe("JavaScript/TypeScript comments", () => {
			test("should clean single-line comment", () => {
				expect(cleanComment("// comment", "javascript")).toBe("comment")
			})

			test("should clean block comment start", () => {
				expect(cleanComment("/* comment", "javascript")).toBe("comment")
			})

			test("should clean block comment end", () => {
				expect(cleanComment("comment */", "javascript")).toBe("comment")
			})

			test("should clean asterisk continuation", () => {
				expect(cleanComment("* comment", "javascript")).toBe("comment")
			})

			test("should clean full block comment", () => {
				const comment = "/* comment line 1\n * comment line 2\n * comment line 3\n */"
				const expected = "comment line 1\ncomment line 2\ncomment line 3"
				expect(cleanComment(comment, "javascript")).toBe(expected)
			})
		})

		describe("Python comments", () => {
			test("should clean hash comment", () => {
				expect(cleanComment("# comment", "python")).toBe("comment")
			})

			test("should clean multi-line hash comments", () => {
				const comment = "# line 1\n# line 2\n# line 3"
				const expected = "line 1\nline 2\nline 3"
				expect(cleanComment(comment, "python")).toBe(expected)
			})

			test("should NOT clean docstring quotes", () => {
				const comment = '"""\nDocstring\n"""'
				const result = cleanComment(comment, "python")
				expect(result).toContain('"""')
			})
		})

		describe("HTML/XML comments", () => {
			test("should clean HTML comment start", () => {
				expect(cleanComment("<!-- comment", "html")).toBe("comment")
			})

			test("should clean HTML comment end", () => {
				expect(cleanComment("comment -->", "html")).toBe("comment")
			})

			test("should clean full HTML comment", () => {
				expect(cleanComment("<!-- comment -->", "html")).toBe("comment")
			})
		})

		describe("SQL comments", () => {
			test("should clean SQL line comment", () => {
				expect(cleanComment("-- comment", "sql")).toBe("comment")
			})
		})

		describe("edge cases", () => {
			test("should handle empty lines in multi-line comment", () => {
				const comment = "// line 1\n//\n// line 3"
				const expected = "line 1\nline 3"
				expect(cleanComment(comment, "javascript")).toBe(expected)
			})

			test("should handle mixed comment styles", () => {
				const comment = "// line 1\n# line 2\n* line 3"
				const expected = "line 1\nline 2\nline 3"
				expect(cleanComment(comment, "javascript")).toBe(expected)
			})

			test("should preserve inner content with comment-like characters", () => {
				expect(cleanComment("// x = y // z", "javascript")).toBe("x = y // z")
			})

			test("should handle comment with only whitespace after prefix", () => {
				expect(cleanComment("//   ", "javascript")).toBe("")
			})

			test("should handle comment with multiple spaces after prefix", () => {
				expect(cleanComment("//     comment", "javascript")).toBe("comment")
			})

			test("should remove trailing block comment end and text after it", () => {
				expect(cleanComment("/* start */ middle */ end", "javascript")).toBe("start */ middle")
			})
		})
	})
})
