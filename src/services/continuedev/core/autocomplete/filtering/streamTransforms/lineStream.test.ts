import { beforeEach, describe, expect, it, Mock, vi } from "vitest"

import {
	avoidPathLine,
	avoidEmptyComments,
	streamWithNewLines,
	lineIsRepeated,
	stopAtSimilarLine,
	stopAtLines,
	LINES_TO_STOP_AT,
	PREFIXES_TO_SKIP,
	skipPrefixes,
	stopAtRepeatingLines,
} from "./lineStream"

describe("lineStream (production-used subset)", () => {
	let mockFullStop: Mock

	async function getLineGenerator(lines: any[]) {
		return (async function* () {
			for (const line of lines) {
				yield line
			}
		})()
	}

	async function getFilteredLines(results: AsyncGenerator<string>) {
		const output: string[] = []
		for await (const line of results) {
			output.push(line)
		}
		return output
	}

	beforeEach(() => {
		mockFullStop = vi.fn()
	})

	describe("avoidPathLine", () => {
		it("filters out '// Path: ...' lines", async () => {
			const linesGenerator = await getLineGenerator([
				"// Path: src/index.ts",
				"const x = 5;",
				"//",
				"console.log(x);",
			])
			const result = avoidPathLine(linesGenerator, "//")
			const filteredLines = await getFilteredLines(result)
			expect(filteredLines).toEqual(["const x = 5;", "//", "console.log(x);"])
		})
	})

	describe("avoidEmptyComments", () => {
		it("filters out empty comment-only lines", async () => {
			const linesGenerator = await getLineGenerator([
				"// Path: src/index.ts",
				"const x = 5;",
				"//",
				"console.log(x);",
			])
			const result = avoidEmptyComments(linesGenerator, "//")
			const filteredLines = await getFilteredLines(result)
			expect(filteredLines).toEqual(["// Path: src/index.ts", "const x = 5;", "console.log(x);"])
		})
	})

	describe("streamWithNewLines", () => {
		it("adds newline separators between lines", async () => {
			const linesGenerator = await getLineGenerator(["line1", "line2", "line3"])
			const result = streamWithNewLines(linesGenerator)
			const filteredLines = await getFilteredLines(result)
			expect(filteredLines).toEqual(["line1", "\n", "line2", "\n", "line3"])
		})
	})

	describe("lineIsRepeated", () => {
		it("returns true for similar lines", () => {
			expect(lineIsRepeated("const x = 5;", "const x = 6;")).toBe(true)
		})

		it("returns false for different lines", () => {
			expect(lineIsRepeated("const x = 5;", "let y = 10;")).toBe(false)
		})

		it("returns false for short lines", () => {
			expect(lineIsRepeated("x=5", "x=6")).toBe(false)
		})
	})

	describe("stopAtSimilarLine", () => {
		it("stops at the exact same line", async () => {
			const lineToTest = "const x = 6"
			const linesGenerator = await getLineGenerator(["console.log();", "const y = () => {};", lineToTest])

			const result = stopAtSimilarLine(linesGenerator, lineToTest, mockFullStop)
			const filteredLines = await getFilteredLines(result)

			expect(filteredLines).toEqual(["console.log();", "const y = () => {};"])
			expect(mockFullStop).toHaveBeenCalledTimes(1)
		})

		it("stops at a similar line", async () => {
			const lineToTest = "const x = 6;"
			const linesGenerator = await getLineGenerator(["console.log();", "const y = () => {};", lineToTest])

			const result = stopAtSimilarLine(linesGenerator, "a" + lineToTest, mockFullStop)
			const filteredLines = await getFilteredLines(result)

			expect(filteredLines).toEqual(["console.log();", "const y = () => {};"])
			expect(mockFullStop).toHaveBeenCalledTimes(1)
		})

		it("continues on bracket-ending lines", async () => {
			const linesGenerator = await getLineGenerator([" if (x > 0) {", "   console.log(x);", " }"])

			const result = stopAtSimilarLine(linesGenerator, "}", mockFullStop)
			const filteredLines = await getFilteredLines(result)

			expect(filteredLines).toEqual([" if (x > 0) {", "   console.log(x);", " }"])
			expect(mockFullStop).toHaveBeenCalledTimes(0)
		})
	})

	describe("stopAtLines", () => {
		it("stops at specified lines", async () => {
			const linesGenerator = await getLineGenerator([
				"const x = 5;",
				"let y = 10;",
				LINES_TO_STOP_AT[0],
				"const z = 15;",
			])

			const result = stopAtLines(linesGenerator, mockFullStop)
			const filteredLines = await getFilteredLines(result)

			expect(filteredLines).toEqual(["const x = 5;", "let y = 10;"])
			expect(mockFullStop).toHaveBeenCalledTimes(1)
		})

		it("stops when stop phrase has leading whitespace", async () => {
			const linesGenerator = await getLineGenerator([
				"const x = 5;",
				"let y = 10;",
				`    ${LINES_TO_STOP_AT[0]}`,
				"const z = 15;",
			])

			const result = stopAtLines(linesGenerator, mockFullStop)
			const filteredLines = await getFilteredLines(result)

			expect(filteredLines).toEqual(["const x = 5;", "let y = 10;"])
			expect(mockFullStop).toHaveBeenCalledTimes(1)
		})
	})

	describe("skipPrefixes", () => {
		it("skips configured prefixes on the first line", async () => {
			const linesGenerator = await getLineGenerator([`${PREFIXES_TO_SKIP[0]}const x = 5;`, "let y = 10;"])

			const result = skipPrefixes(linesGenerator)
			const filteredLines = await getFilteredLines(result)

			expect(filteredLines).toEqual(["const x = 5;", "let y = 10;"])
		})
	})

	describe("stopAtRepeatingLines", () => {
		it("yields non-repeating lines and does not stop prematurely", async () => {
			const linesGenerator = await getLineGenerator(["a", "b", "c", "d", "e"])

			const result = stopAtRepeatingLines(linesGenerator as any, mockFullStop)
			const filteredLines = await getFilteredLines(result as any)

			expect(filteredLines).toEqual(["a", "b", "c", "d", "e"])
			expect(mockFullStop).not.toHaveBeenCalled()
		})

		it("stops when a line repeats 3 times consecutively", async () => {
			const linesGenerator = await getLineGenerator(["x", "x", "x", "x", "after"])

			const result = stopAtRepeatingLines(linesGenerator as any, mockFullStop)
			const filteredLines = await getFilteredLines(result as any)

			// Only the first of the repeating lines is yielded
			expect(filteredLines).toEqual(["x"])
			expect(mockFullStop).toHaveBeenCalledTimes(1)
		})
	})
})
