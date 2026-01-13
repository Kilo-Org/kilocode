import { parsePatch, ParseError } from "../parser"

describe("apply_patch parser", () => {
	describe("parsePatch", () => {
		it("should reject patch without Begin Patch marker", () => {
			expect(() => parsePatch("bad")).toThrow(ParseError)
			expect(() => parsePatch("bad")).toThrow("The first line of the patch must be '*** Begin Patch'")
		})

		it("should reject patch without End Patch marker", () => {
			expect(() => parsePatch("*** Begin Patch\nbad")).toThrow(ParseError)
			expect(() => parsePatch("*** Begin Patch\nbad")).toThrow(
				"The last line of the patch must be '*** End Patch'",
			)
		})

		it("should parse empty patch", () => {
			const result = parsePatch("*** Begin Patch\n*** End Patch")
			expect(result.hunks).toEqual([])
		})

		it("should parse Add File hunk", () => {
			const result = parsePatch(`*** Begin Patch
*** Add File: path/add.py
+abc
+def
*** End Patch`)

			expect(result.hunks).toHaveLength(1)
			expect(result.hunks[0]).toEqual({
				type: "AddFile",
				path: "path/add.py",
				contents: "abc\ndef\n",
			})
		})

		it("should parse Delete File hunk", () => {
			const result = parsePatch(`*** Begin Patch
*** Delete File: path/delete.py
*** End Patch`)

			expect(result.hunks).toHaveLength(1)
			expect(result.hunks[0]).toEqual({
				type: "DeleteFile",
				path: "path/delete.py",
			})
		})

		it("should parse Update File hunk with context", () => {
			const result = parsePatch(`*** Begin Patch
*** Update File: path/update.py
@@ def f():
-    pass
+    return 123
*** End Patch`)

			expect(result.hunks).toHaveLength(1)
			expect(result.hunks[0]).toEqual({
				type: "UpdateFile",
				path: "path/update.py",
				movePath: null,
				chunks: [
					{
						changeContext: "def f():",
						oldLines: ["    pass"],
						newLines: ["    return 123"],
						isEndOfFile: false,
					},
				],
			})
		})

		it("should parse Update File hunk with Move to", () => {
			const result = parsePatch(`*** Begin Patch
*** Update File: path/update.py
*** Move to: path/update2.py
@@ def f():
-    pass
+    return 123
*** End Patch`)

			expect(result.hunks).toHaveLength(1)
			expect(result.hunks[0]).toEqual({
				type: "UpdateFile",
				path: "path/update.py",
				movePath: "path/update2.py",
				chunks: [
					{
						changeContext: "def f():",
						oldLines: ["    pass"],
						newLines: ["    return 123"],
						isEndOfFile: false,
					},
				],
			})
		})

		it("should parse Update File hunk with empty context marker", () => {
			const result = parsePatch(`*** Begin Patch
*** Update File: file.py
@@
+line
*** End Patch`)

			expect(result.hunks).toHaveLength(1)
			expect(result.hunks[0]).toEqual({
				type: "UpdateFile",
				path: "file.py",
				movePath: null,
				chunks: [
					{
						changeContext: null,
						oldLines: [],
						newLines: ["line"],
						isEndOfFile: false,
					},
				],
			})
		})

		it("should parse multiple hunks", () => {
			const result = parsePatch(`*** Begin Patch
*** Add File: path/add.py
+abc
+def
*** Delete File: path/delete.py
*** Update File: path/update.py
*** Move to: path/update2.py
@@ def f():
-    pass
+    return 123
*** End Patch`)

			expect(result.hunks).toHaveLength(3)
			expect(result.hunks[0]).toEqual({
				type: "AddFile",
				path: "path/add.py",
				contents: "abc\ndef\n",
			})
			expect(result.hunks[1]).toEqual({
				type: "DeleteFile",
				path: "path/delete.py",
			})
			expect(result.hunks[2]).toEqual({
				type: "UpdateFile",
				path: "path/update.py",
				movePath: "path/update2.py",
				chunks: [
					{
						changeContext: "def f():",
						oldLines: ["    pass"],
						newLines: ["    return 123"],
						isEndOfFile: false,
					},
				],
			})
		})

		it("should parse Update hunk followed by Add hunk", () => {
			const result = parsePatch(`*** Begin Patch
*** Update File: file.py
@@
+line
*** Add File: other.py
+content
*** End Patch`)

			expect(result.hunks).toHaveLength(2)
			expect(result.hunks[0]).toEqual({
				type: "UpdateFile",
				path: "file.py",
				movePath: null,
				chunks: [
					{
						changeContext: null,
						oldLines: [],
						newLines: ["line"],
						isEndOfFile: false,
					},
				],
			})
			expect(result.hunks[1]).toEqual({
				type: "AddFile",
				path: "other.py",
				contents: "content\n",
			})
		})

		it("should parse Update hunk without explicit @@ header for first chunk", () => {
			const result = parsePatch(`*** Begin Patch
*** Update File: file2.py
 import foo
+bar
*** End Patch`)

			expect(result.hunks).toHaveLength(1)
			expect(result.hunks[0]).toEqual({
				type: "UpdateFile",
				path: "file2.py",
				movePath: null,
				chunks: [
					{
						changeContext: null,
						oldLines: ["import foo"],
						newLines: ["import foo", "bar"],
						isEndOfFile: false,
					},
				],
			})
		})

		it("should reject empty Update File hunk", () => {
			expect(() =>
				parsePatch(`*** Begin Patch
*** Update File: test.py
*** End Patch`),
			).toThrow(ParseError)
		})

		it("should handle heredoc-wrapped patches (lenient mode)", () => {
			const result = parsePatch(`<<EOF
*** Begin Patch
*** Add File: foo
+hi
*** End Patch
EOF`)

			expect(result.hunks).toHaveLength(1)
			expect(result.hunks[0]).toEqual({
				type: "AddFile",
				path: "foo",
				contents: "hi\n",
			})
		})

		it("should handle single-quoted heredoc", () => {
			const result = parsePatch(`<<'EOF'
*** Begin Patch
*** Add File: foo
+hi
*** End Patch
EOF`)

			expect(result.hunks).toHaveLength(1)
		})

		it("should handle double-quoted heredoc", () => {
			const result = parsePatch(`<<"EOF"
*** Begin Patch
*** Add File: foo
+hi
*** End Patch
EOF`)

			expect(result.hunks).toHaveLength(1)
		})

		it("should parse chunk with End of File marker", () => {
			const result = parsePatch(`*** Begin Patch
*** Update File: file.py
@@
+line
*** End of File
*** End Patch`)

			expect(result.hunks).toHaveLength(1)
			expect(result.hunks[0]).toEqual({
				type: "UpdateFile",
				path: "file.py",
				movePath: null,
				chunks: [
					{
						changeContext: null,
						oldLines: [],
						newLines: ["line"],
						isEndOfFile: true,
					},
				],
			})
		})

		it("should parse multiple chunks in one Update File", () => {
			const result = parsePatch(`*** Begin Patch
*** Update File: multi.txt
@@
 foo
-bar
+BAR
@@
 baz
-qux
+QUX
*** End Patch`)

			expect(result.hunks).toHaveLength(1)
			expect(result.hunks[0]).toEqual({
				type: "UpdateFile",
				path: "multi.txt",
				movePath: null,
				chunks: [
					{
						changeContext: null,
						oldLines: ["foo", "bar"],
						newLines: ["foo", "BAR"],
						isEndOfFile: false,
					},
					{
						changeContext: null,
						oldLines: ["baz", "qux"],
						newLines: ["baz", "QUX"],
						isEndOfFile: false,
					},
				],
			})
		})
	})
})
