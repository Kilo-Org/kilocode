import { Uri } from "../classes/Uri.js"

describe("Uri", () => {
	describe("file()", () => {
		it("should create a file URI", () => {
			const uri = Uri.file("/path/to/file.txt")
			expect(uri.scheme).toBe("file")
			expect(uri.path).toBe("/path/to/file.txt")
			expect(uri.fsPath).toBe("/path/to/file.txt")
		})

		it("should handle Windows paths", () => {
			const uri = Uri.file("C:\\Users\\test\\file.txt")
			expect(uri.scheme).toBe("file")
			expect(uri.fsPath).toBe("C:\\Users\\test\\file.txt")
		})
	})

	describe("parse()", () => {
		it("should parse HTTP URLs", () => {
			const uri = Uri.parse("https://example.com/path?query=1#fragment")
			expect(uri.scheme).toBe("https")
			expect(uri.authority).toBe("example.com")
			expect(uri.path).toBe("/path")
			expect(uri.query).toBe("query=1")
			expect(uri.fragment).toBe("fragment")
		})

		it("should parse file URLs", () => {
			const uri = Uri.parse("file:///path/to/file.txt")
			expect(uri.scheme).toBe("file")
			expect(uri.path).toBe("/path/to/file.txt")
		})

		it("should handle invalid URLs by treating as file paths", () => {
			const uri = Uri.parse("/just/a/path")
			expect(uri.scheme).toBe("file")
			expect(uri.fsPath).toBe("/just/a/path")
		})
	})

	describe("joinPath()", () => {
		it("should join path segments", () => {
			const base = Uri.file("/base/path")
			const joined = Uri.joinPath(base, "sub", "file.txt")
			expect(joined.fsPath).toContain("sub")
			expect(joined.fsPath).toContain("file.txt")
		})
	})

	describe("with()", () => {
		it("should create new URI with modified scheme", () => {
			const uri = Uri.file("/path/to/file.txt")
			const modified = uri.with({ scheme: "vscode" })
			expect(modified.scheme).toBe("vscode")
			expect(modified.path).toBe("/path/to/file.txt")
		})

		it("should create new URI with modified path", () => {
			const uri = Uri.parse("https://example.com/old/path")
			const modified = uri.with({ path: "/new/path" })
			expect(modified.path).toBe("/new/path")
			expect(modified.scheme).toBe("https")
		})

		it("should preserve unchanged properties", () => {
			const uri = Uri.parse("https://example.com/path?query=1#fragment")
			const modified = uri.with({ path: "/newpath" })
			expect(modified.scheme).toBe("https")
			expect(modified.query).toBe("query=1")
			expect(modified.fragment).toBe("fragment")
		})
	})

	describe("toString()", () => {
		it("should convert to URI string", () => {
			const uri = Uri.parse("https://example.com/path?query=1#fragment")
			const str = uri.toString()
			expect(str).toBe("https://example.com/path?query=1#fragment")
		})

		it("should handle file URIs", () => {
			const uri = Uri.file("/path/to/file.txt")
			const str = uri.toString()
			expect(str).toBe("file:///path/to/file.txt")
		})
	})

	describe("toJSON()", () => {
		it("should convert to JSON object", () => {
			const uri = Uri.parse("https://example.com/path?query=1#fragment")
			const json = uri.toJSON()
			expect(json).toEqual({
				scheme: "https",
				authority: "example.com",
				path: "/path",
				query: "query=1",
				fragment: "fragment",
			})
		})
	})
})
