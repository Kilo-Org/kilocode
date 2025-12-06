// kilocode_change - new file
// npx vitest utils/__tests__/pathUtils.spec.ts

import { parseParamsFromArgs } from "../pathUtils"

describe("parseParamsFromArgs", () => {
	describe("parameter extraction", () => {
		it("should extract parameters from XML file tag", () => {
			const args = `
				<args>
					<file>
						<path>src/main.ts</path>
						<content>console.log('hello')</content>
					</file>
				</args>
			`

			const result = parseParamsFromArgs(args, ["path", "content"])
			expect(result).toEqual({
				path: "src/main.ts",
				content: "console.log('hello')",
			})
		})

		it("should handle XML with multiple file tags", () => {
			const args = `
				<args>
					<file>
						<path>src/file1.ts</path>
						<content>first file</content>
					</file>
					<file>
						<path>src/file2.ts</path>
						<content>second file</content>
					</file>
				</args>
			`

			const result = parseParamsFromArgs(args, ["path", "content"])
			expect(result).toEqual({
				path: "src/file1.ts",
				content: "first file",
			})
		})

		it("should handle XML with root-level parameters", () => {
			const args = `
				<args>
					<path>src/main.ts</path>
					<content>console.log('hello')</content>
				</args>
			`

			const result = parseParamsFromArgs(args, ["path", "content"])
			expect(result).toEqual({
				path: "src/main.ts",
				content: "console.log('hello')",
			})
		})

		it("should handle missing parameters gracefully", () => {
			const args = `
				<args>
					<file>
						<path>src/main.ts</path>
					</file>
				</args>
			`

			const result = parseParamsFromArgs(args, ["path", "content"])
			expect(result).toEqual({
				path: "src/main.ts",
				content: undefined,
			})
		})

		it("should return empty object when no args provided", () => {
			const result = parseParamsFromArgs(undefined, ["path"])
			expect(result).toEqual({})
		})

		it("should return empty object when empty args provided", () => {
			const result = parseParamsFromArgs("", ["path"])
			expect(result).toEqual({})
		})

		it("should extract only specified parameters", () => {
			const args = `
				<args>
					<file>
						<path>src/main.ts</path>
						<content>console.log('hello')</content>
						<line>10</line>
					</file>
				</args>
			`

			const result = parseParamsFromArgs(args, ["path"])
			expect(result).toEqual({
				path: "src/main.ts",
			})
		})

		it("should handle complex parameter names", () => {
			const args = `
				<args>
					<file>
						<target_file>src/main.ts</target_file>
						<old_str>old code</old_str>
						<new_str>new code</new_str>
					</file>
				</args>
			`

			const result = parseParamsFromArgs(args, ["target_file", "old_str", "new_str"])
			expect(result).toEqual({
				target_file: "src/main.ts",
				old_str: "old code",
				new_str: "new code",
			})
		})
	})
})
