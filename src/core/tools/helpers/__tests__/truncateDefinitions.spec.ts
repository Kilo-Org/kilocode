import { describe, it, expect } from "vitest"
import { truncateDefinitionsToLineLimit } from "../truncateDefinitions"

describe("truncateDefinitionsToLineLimit", () => {
	it("should not truncate when maxReadFileLine is -1 (no limit)", () => {
		const definitions = `# test.ts
10--20 | function foo() {
30--40 | function bar() {
50--60 | function baz() {`

		const result = truncateDefinitionsToLineLimit(definitions, -1)
		expect(result).toBe(definitions)
	})

	it("should not truncate when maxReadFileLine is 0 (definitions only mode)", () => {
		const definitions = `# test.ts
10--20 | function foo() {
30--40 | function bar() {
50--60 | function baz() {`

		const result = truncateDefinitionsToLineLimit(definitions, 0)
		expect(result).toBe(definitions)
	})

	it("should truncate definitions beyond the line limit", () => {
		const definitions = `# test.ts
10--20 | function foo() {
30--40 | function bar() {
50--60 | function baz() {`

		const result = truncateDefinitionsToLineLimit(definitions, 25)
		const expected = `# test.ts
10--20 | function foo() {`

		expect(result).toBe(expected)
	})

	it("should include definitions that start within limit even if they end beyond it", () => {
		const definitions = `# test.ts
10--50 | function foo() {
60--80 | function bar() {`

		const result = truncateDefinitionsToLineLimit(definitions, 30)
		const expected = `# test.ts
10--50 | function foo() {`

		expect(result).toBe(expected)
	})

	it("should handle single-line definitions", () => {
		const definitions = `# test.ts
10 | const foo = 1
20 | const bar = 2
30 | const baz = 3`

		const result = truncateDefinitionsToLineLimit(definitions, 25)
		const expected = `# test.ts
10 | const foo = 1
20 | const bar = 2`

		expect(result).toBe(expected)
	})

	it("should preserve header line when all definitions are beyond limit", () => {
		const definitions = `# test.ts
100--200 | function foo() {`

		const result = truncateDefinitionsToLineLimit(definitions, 50)
		const expected = `# test.ts`

		expect(result).toBe(expected)
	})

	it("should handle empty definitions", () => {
		const definitions = `# test.ts`

		const result = truncateDefinitionsToLineLimit(definitions, 50)
		expect(result).toBe(definitions)
	})

	it("should handle definitions without header", () => {
		const definitions = `10--20 | function foo() {
30--40 | function bar() {`

		const result = truncateDefinitionsToLineLimit(definitions, 25)
		const expected = `10--20 | function foo() {`

		expect(result).toBe(expected)
	})

	it("should not preserve empty lines (only definition lines)", () => {
		const definitions = `# test.ts
10--20 | function foo() {

30--40 | function bar() {`

		const result = truncateDefinitionsToLineLimit(definitions, 25)
		const expected = `# test.ts
10--20 | function foo() {`

		expect(result).toBe(expected)
	})

	it("should handle mixed single and range definitions", () => {
		const definitions = `# test.ts
5 | const x = 1
10--20 | function foo() {
25 | const y = 2
30--40 | function bar() {`

		const result = truncateDefinitionsToLineLimit(definitions, 26)
		const expected = `# test.ts
5 | const x = 1
10--20 | function foo() {
25 | const y = 2`

		expect(result).toBe(expected)
	})

	it("should handle definitions at exactly the limit", () => {
		const definitions = `# test.ts
10--20 | function foo() {
30--40 | function bar() {
50--60 | function baz() {`

		const result = truncateDefinitionsToLineLimit(definitions, 30)
		const expected = `# test.ts
10--20 | function foo() {
30--40 | function bar() {`

		expect(result).toBe(expected)
	})

	it("should handle definitions with leading whitespace", () => {
		const definitions = `# test.ts
	 10--20 | function foo() {
	 30--40 | function bar() {
	 50--60 | function baz() {`

		const result = truncateDefinitionsToLineLimit(definitions, 25)
		const expected = `# test.ts
	 10--20 | function foo() {`

		expect(result).toBe(expected)
	})

	it("should handle definitions with mixed whitespace patterns", () => {
		const definitions = `# test.ts
10--20 | function foo() {
	 30--40 | function bar() {
	50--60 | function baz() {`

		const result = truncateDefinitionsToLineLimit(definitions, 35)
		const expected = `# test.ts
10--20 | function foo() {
	 30--40 | function bar() {`

		expect(result).toBe(expected)
	})
})
