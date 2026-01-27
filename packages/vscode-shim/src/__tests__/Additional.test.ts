import {
	Location,
	DiagnosticRelatedInformation,
	Diagnostic,
	ThemeColor,
	ThemeIcon,
	CodeActionKind,
	CodeLens,
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	FileSystemError,
} from "../classes/Additional.js"
import { Uri } from "../classes/Uri.js"
import { Range } from "../classes/Range.js"
import { Position } from "../classes/Position.js"

describe("Location", () => {
	it("should create location with URI and Range", () => {
		const uri = Uri.file("/path/to/file.txt")
		const range = new Range(0, 0, 5, 10)
		const location = new Location(uri, range)

		expect(location.uri).toBe(uri)
		expect(location.range).toBe(range)
	})

	it("should create location with URI and Position", () => {
		const uri = Uri.file("/path/to/file.txt")
		const position = new Position(5, 10)
		const location = new Location(uri, position)

		expect(location.uri).toBe(uri)
		expect(location.range).toBe(position)
	})
})

describe("DiagnosticRelatedInformation", () => {
	it("should create diagnostic related information", () => {
		const uri = Uri.file("/path/to/file.txt")
		const range = new Range(0, 0, 1, 0)
		const location = new Location(uri, range)
		const message = "Related issue here"

		const info = new DiagnosticRelatedInformation(location, message)

		expect(info.location).toBe(location)
		expect(info.message).toBe(message)
	})
})

describe("Diagnostic", () => {
	it("should create diagnostic with default severity (Error)", () => {
		const range = new Range(0, 0, 0, 10)
		const message = "Error message"

		const diagnostic = new Diagnostic(range, message)

		expect(diagnostic.range.isEqual(range)).toBe(true)
		expect(diagnostic.message).toBe(message)
		expect(diagnostic.severity).toBe(0) // Error
	})

	it("should create diagnostic with custom severity", () => {
		const range = new Range(0, 0, 0, 10)
		const message = "Warning message"

		const diagnostic = new Diagnostic(range, message, 1) // Warning

		expect(diagnostic.severity).toBe(1)
	})

	it("should allow setting optional properties", () => {
		const range = new Range(0, 0, 0, 10)
		const diagnostic = new Diagnostic(range, "Test")

		diagnostic.source = "eslint"
		diagnostic.code = "no-unused-vars"
		diagnostic.tags = [1] // Unnecessary

		expect(diagnostic.source).toBe("eslint")
		expect(diagnostic.code).toBe("no-unused-vars")
		expect(diagnostic.tags).toEqual([1])
	})

	it("should allow setting related information", () => {
		const range = new Range(0, 0, 0, 10)
		const diagnostic = new Diagnostic(range, "Test")

		const relatedUri = Uri.file("/related.txt")
		const relatedLocation = new Location(relatedUri, new Range(1, 0, 1, 5))
		const relatedInfo = new DiagnosticRelatedInformation(relatedLocation, "Related issue")

		diagnostic.relatedInformation = [relatedInfo]

		expect(diagnostic.relatedInformation).toHaveLength(1)
		expect(diagnostic.relatedInformation[0]?.message).toBe("Related issue")
	})
})

describe("ThemeColor", () => {
	it("should create theme color with ID", () => {
		const color = new ThemeColor("editor.foreground")

		expect(color.id).toBe("editor.foreground")
	})

	it("should handle custom color IDs", () => {
		const color = new ThemeColor("myExtension.customColor")

		expect(color.id).toBe("myExtension.customColor")
	})
})

describe("ThemeIcon", () => {
	it("should create theme icon with ID", () => {
		const icon = new ThemeIcon("file")

		expect(icon.id).toBe("file")
		expect(icon.color).toBeUndefined()
	})

	it("should create theme icon with ID and color", () => {
		const color = new ThemeColor("errorForeground")
		const icon = new ThemeIcon("error", color)

		expect(icon.id).toBe("error")
		expect(icon.color).toBe(color)
		expect(icon.color?.id).toBe("errorForeground")
	})
})

describe("CodeActionKind", () => {
	describe("static properties", () => {
		it("should have Empty kind", () => {
			expect(CodeActionKind.Empty.value).toBe("")
		})

		it("should have QuickFix kind", () => {
			expect(CodeActionKind.QuickFix.value).toBe("quickfix")
		})

		it("should have Refactor kind", () => {
			expect(CodeActionKind.Refactor.value).toBe("refactor")
		})

		it("should have RefactorExtract kind", () => {
			expect(CodeActionKind.RefactorExtract.value).toBe("refactor.extract")
		})

		it("should have RefactorInline kind", () => {
			expect(CodeActionKind.RefactorInline.value).toBe("refactor.inline")
		})

		it("should have RefactorRewrite kind", () => {
			expect(CodeActionKind.RefactorRewrite.value).toBe("refactor.rewrite")
		})

		it("should have Source kind", () => {
			expect(CodeActionKind.Source.value).toBe("source")
		})

		it("should have SourceOrganizeImports kind", () => {
			expect(CodeActionKind.SourceOrganizeImports.value).toBe("source.organizeImports")
		})
	})

	describe("constructor", () => {
		it("should create custom kind", () => {
			const kind = new CodeActionKind("custom.action")
			expect(kind.value).toBe("custom.action")
		})
	})

	describe("append()", () => {
		it("should append to existing kind", () => {
			const kind = new CodeActionKind("refactor")
			const appended = kind.append("extract")

			expect(appended.value).toBe("refactor.extract")
		})

		it("should handle empty kind", () => {
			const kind = new CodeActionKind("")
			const appended = kind.append("quickfix")

			expect(appended.value).toBe("quickfix")
		})
	})

	describe("contains()", () => {
		it("should return true when kind contains another", () => {
			const parent = CodeActionKind.Refactor
			const child = CodeActionKind.RefactorExtract

			expect(parent.contains(child)).toBe(true)
		})

		it("should return false when kinds are different hierarchies", () => {
			const quickfix = CodeActionKind.QuickFix
			const refactor = CodeActionKind.Refactor

			expect(quickfix.contains(refactor)).toBe(false)
		})

		it("should return true for equal kinds", () => {
			const kind = new CodeActionKind("quickfix")
			expect(kind.contains(CodeActionKind.QuickFix)).toBe(true)
		})
	})

	describe("intersects()", () => {
		it("should return true when one contains the other", () => {
			const parent = CodeActionKind.Refactor
			const child = CodeActionKind.RefactorExtract

			expect(parent.intersects(child)).toBe(true)
			expect(child.intersects(parent)).toBe(true)
		})

		it("should return false for non-intersecting kinds", () => {
			const quickfix = CodeActionKind.QuickFix
			const source = CodeActionKind.Source

			expect(quickfix.intersects(source)).toBe(false)
		})
	})
})

describe("CodeLens", () => {
	it("should create CodeLens with range only", () => {
		const range = new Range(0, 0, 0, 10)
		const lens = new CodeLens(range)

		expect(lens.range.isEqual(range)).toBe(true)
		expect(lens.command).toBeUndefined()
		expect(lens.isResolved).toBe(false)
	})

	it("should create CodeLens with range and command", () => {
		const range = new Range(5, 0, 5, 20)
		const command = {
			command: "myExtension.doSomething",
			title: "Click me",
			arguments: [1, 2, 3],
		}
		const lens = new CodeLens(range, command)

		expect(lens.range).toBeDefined()
		expect(lens.command?.command).toBe("myExtension.doSomething")
		expect(lens.command?.title).toBe("Click me")
		expect(lens.command?.arguments).toEqual([1, 2, 3])
	})
})

describe("LanguageModelTextPart", () => {
	it("should create text part with value", () => {
		const part = new LanguageModelTextPart("Hello, world!")

		expect(part.value).toBe("Hello, world!")
	})
})

describe("LanguageModelToolCallPart", () => {
	it("should create tool call part", () => {
		const part = new LanguageModelToolCallPart("call-123", "searchFiles", { query: "test" })

		expect(part.callId).toBe("call-123")
		expect(part.name).toBe("searchFiles")
		expect(part.input).toEqual({ query: "test" })
	})
})

describe("LanguageModelToolResultPart", () => {
	it("should create tool result part", () => {
		const part = new LanguageModelToolResultPart("call-123", [{ type: "text", text: "result" }])

		expect(part.callId).toBe("call-123")
		expect(part.content).toHaveLength(1)
		expect(part.content[0]).toEqual({ type: "text", text: "result" })
	})
})

describe("FileSystemError", () => {
	describe("constructor", () => {
		it("should create error with message", () => {
			const error = new FileSystemError("Something went wrong")

			expect(error.message).toBe("Something went wrong")
			expect(error.code).toBe("Unknown")
			expect(error.name).toBe("FileSystemError")
		})

		it("should create error with message and code", () => {
			const error = new FileSystemError("Custom error", "CustomCode")

			expect(error.message).toBe("Custom error")
			expect(error.code).toBe("CustomCode")
		})
	})

	describe("FileNotFound()", () => {
		it("should create FileNotFound error from string", () => {
			const error = FileSystemError.FileNotFound("File not found: /path/to/file")

			expect(error.message).toBe("File not found: /path/to/file")
			expect(error.code).toBe("FileNotFound")
		})

		it("should create FileNotFound error from URI", () => {
			const uri = Uri.file("/path/to/file.txt")
			const error = FileSystemError.FileNotFound(uri)

			expect(error.message).toContain("/path/to/file.txt")
			expect(error.code).toBe("FileNotFound")
		})

		it("should handle undefined input", () => {
			const error = FileSystemError.FileNotFound()

			expect(error.message).toContain("unknown")
			expect(error.code).toBe("FileNotFound")
		})
	})

	describe("FileExists()", () => {
		it("should create FileExists error", () => {
			const error = FileSystemError.FileExists("File already exists")

			expect(error.message).toBe("File already exists")
			expect(error.code).toBe("FileExists")
		})

		it("should create FileExists error from URI", () => {
			const uri = Uri.file("/existing/file.txt")
			const error = FileSystemError.FileExists(uri)

			expect(error.message).toContain("/existing/file.txt")
			expect(error.code).toBe("FileExists")
		})
	})

	describe("FileNotADirectory()", () => {
		it("should create FileNotADirectory error", () => {
			const error = FileSystemError.FileNotADirectory("Not a directory")

			expect(error.message).toBe("Not a directory")
			expect(error.code).toBe("FileNotADirectory")
		})
	})

	describe("FileIsADirectory()", () => {
		it("should create FileIsADirectory error", () => {
			const error = FileSystemError.FileIsADirectory("Is a directory")

			expect(error.message).toBe("Is a directory")
			expect(error.code).toBe("FileIsADirectory")
		})
	})

	describe("NoPermissions()", () => {
		it("should create NoPermissions error", () => {
			const error = FileSystemError.NoPermissions("Access denied")

			expect(error.message).toBe("Access denied")
			expect(error.code).toBe("NoPermissions")
		})
	})

	describe("Unavailable()", () => {
		it("should create Unavailable error", () => {
			const error = FileSystemError.Unavailable("Resource unavailable")

			expect(error.message).toBe("Resource unavailable")
			expect(error.code).toBe("Unavailable")
		})
	})
})
