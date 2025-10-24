import { StrategyTester } from "../strategy-tester.js"
import { LLMClient } from "../llm-client.js"

// Mock vscode module
vi.mock("vscode", () => ({
	Uri: {
		parse: (path: string) => ({ toString: () => path, fsPath: path }),
	},
	Range: class Range {
		constructor(
			public start: any,
			public end: any,
		) {}
	},
	Position: class Position {
		constructor(
			public line: number,
			public character: number,
		) {}
	},
	workspace: {
		asRelativePath: (uri: any) => uri.toString(),
	},
}))

/**
 * Comprehensive tests for StrategyTester.parseCompletion and applyOperations methods
 *
 * These tests verify the refactored diff-based application logic that:
 * 1. Parses XML responses using GhostStreamingParser
 * 2. Extracts diff operations from the parsed result
 * 3. Applies operations to reconstruct modified code
 *
 * Note: The parser uses fuzzy matching to find search patterns in the document,
 * so the search content in XML must closely match the original content.
 */
describe("StrategyTester.parseCompletion", () => {
	let strategyTester: StrategyTester
	let mockLLMClient: LLMClient

	beforeEach(() => {
		// Setup mock LLM client - not needed for parseCompletion tests
		mockLLMClient = {
			sendPrompt: vi.fn(),
		} as any

		strategyTester = new StrategyTester(mockLLMClient)
	})

	describe("basic functionality", () => {
		it("should return null for empty XML response", () => {
			const originalContent = "const x = 1"
			const xmlResponse = ""

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBeNull()
		})

		it("should return null for malformed XML", () => {
			const originalContent = "const x = 1"
			const xmlResponse = "<change><search>incomplete"

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBeNull()
		})

		it("should return null when no suggestions are parsed", () => {
			const originalContent = "const x = 1"
			const xmlResponse = "<change></change>"

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBeNull()
		})

		it("should return null for empty operations array", () => {
			const originalContent = "const x = 1"
			// XML with search/replace that doesn't match anything in the document
			const xmlResponse = `<change><search><![CDATA[nonexistent code that will never match]]></search><replace><![CDATA[replacement]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBeNull()
		})
	})

	describe("diff operations - additions", () => {
		it("should handle simple addition (adding new lines)", () => {
			const originalContent = "const x = 1"
			// Search must match the original content exactly for the parser to find it
			const xmlResponse = `<change><search><![CDATA[const x = 1]]></search><replace><![CDATA[const x = 1
const y = 2]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe("const x = 1\nconst y = 2")
		})

		it("should handle multiple line additions", () => {
			const originalContent = "const x = 1"
			const xmlResponse = `<change><search><![CDATA[const x = 1]]></search><replace><![CDATA[const x = 1
const y = 2
const z = 3]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe("const x = 1\nconst y = 2\nconst z = 3")
		})

		it("should handle addition in middle of file", () => {
			const originalContent = "const x = 1\nconst z = 3"
			const xmlResponse = `<change><search><![CDATA[const x = 1
const z = 3]]></search><replace><![CDATA[const x = 1
const y = 2
const z = 3]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe("const x = 1\nconst y = 2\nconst z = 3")
		})
	})

	describe("diff operations - deletions", () => {
		it("should handle simple deletion (removing lines)", () => {
			const originalContent = "const x = 1\nconst y = 2"
			const xmlResponse = `<change><search><![CDATA[const x = 1
const y = 2]]></search><replace><![CDATA[const x = 1]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe("const x = 1")
		})

		it("should handle deletion in middle of file", () => {
			const originalContent = "const x = 1\nconst y = 2\nconst z = 3"
			const xmlResponse = `<change><search><![CDATA[const x = 1
const y = 2
const z = 3]]></search><replace><![CDATA[const x = 1
const z = 3]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe("const x = 1\nconst z = 3")
		})
	})

	describe("diff operations - modifications", () => {
		it("should handle modification (delete + add on same line)", () => {
			const originalContent = "var x = 1"
			const xmlResponse = `<change><search><![CDATA[var x = 1]]></search><replace><![CDATA[const x = 1]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe("const x = 1")
		})

		it("should handle function modification", () => {
			const originalContent = `function test() {
	var x = 1
	return x
}`
			const xmlResponse = `<change><search><![CDATA[function test() {
	var x = 1
	return x
}]]></search><replace><![CDATA[function test() {
	const x = 1
	return x
}]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`function test() {
	const x = 1
	return x
}`)
		})

		it("should handle multiple modifications across different lines", () => {
			const originalContent = `var x = 1
var y = 2
var z = 3`
			// Multiple change blocks for multiple modifications
			const xmlResponse = `<change><search><![CDATA[var x = 1]]></search><replace><![CDATA[const x = 1]]></replace></change><change><search><![CDATA[var y = 2]]></search><replace><![CDATA[const y = 2]]></replace></change><change><search><![CDATA[var z = 3]]></search><replace><![CDATA[const z = 3]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`const x = 1
const y = 2
const z = 3`)
		})
	})

	describe("diff operations - mixed operations", () => {
		it("should handle mixed additions and deletions", () => {
			const originalContent = `const x = 1
const y = 2
const z = 3`
			const xmlResponse = `<change><search><![CDATA[const x = 1
const y = 2
const z = 3]]></search><replace><![CDATA[const x = 1
const w = 1.5
const z = 3]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`const x = 1
const w = 1.5
const z = 3`)
		})

		it("should handle complex multi-line changes", () => {
			const originalContent = `function calculate(a, b) {
	var sum = a + b
	return sum
}`
			const xmlResponse = `<change><search><![CDATA[function calculate(a, b) {
	var sum = a + b
	return sum
}]]></search><replace><![CDATA[function calculate(a, b) {
	// Calculate the sum
	const sum = a + b
	console.log('Sum:', sum)
	return sum
}]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`function calculate(a, b) {
	// Calculate the sum
	const sum = a + b
	console.log('Sum:', sum)
	return sum
}`)
		})
	})

	describe("edge cases", () => {
		it("should handle empty lines in operations", () => {
			const originalContent = `const x = 1

const y = 2`
			const xmlResponse = `<change><search><![CDATA[const x = 1

const y = 2]]></search><replace><![CDATA[const x = 1
const y = 2]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`const x = 1
const y = 2`)
		})

		it("should handle operations with special characters", () => {
			const originalContent = `const regex = /test/`
			const xmlResponse = `<change><search><![CDATA[const regex = /test/]]></search><replace><![CDATA[const regex = /test$/]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`const regex = /test$/`)
		})

		it("should preserve indentation in operations", () => {
			const originalContent = `function test() {
	if (true) {
		return 1
	}
}`
			const xmlResponse = `<change><search><![CDATA[	if (true) {
		return 1
	}]]></search><replace><![CDATA[	if (true) {
		console.log('test')
		return 1
	}]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`function test() {
	if (true) {
		console.log('test')
		return 1
	}
}`)
		})

		it("should handle CDATA sections with special XML characters", () => {
			const originalContent = `const html = "<div>test</div>"`
			const xmlResponse = `<change><search><![CDATA[const html = "<div>test</div>"]]></search><replace><![CDATA[const html = "<div>test & more</div>"]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`const html = "<div>test & more</div>"`)
		})

		it("should handle single line file", () => {
			const originalContent = `const x = 1`
			const xmlResponse = `<change><search><![CDATA[const x = 1]]></search><replace><![CDATA[const x = 2]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`const x = 2`)
		})
	})

	describe("error handling", () => {
		it("should handle parser errors gracefully (return null)", () => {
			const originalContent = "const x = 1"
			const xmlResponse = "<invalid>xml</that><breaks>parser"

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBeNull()
		})

		it("should handle XML without CDATA sections", () => {
			const originalContent = "const x = 1"
			const xmlResponse = `<change><search>const x = 1</search><replace>const x = 2</replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			// Parser requires CDATA sections, so this should return null
			expect(result).toBeNull()
		})
	})

	describe("integration with real XML responses", () => {
		it("should handle single change block", () => {
			const originalContent = `function test() {
	return true
}`
			const xmlResponse = `<change><search><![CDATA[function test() {
	return true
}]]></search><replace><![CDATA[function test() {
	// Added comment
	return true
}]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`function test() {
	// Added comment
	return true
}`)
		})

		it("should handle multiple change blocks", () => {
			const originalContent = `function test() {
	return true
}

function other() {
	return false
}`
			const xmlResponse = `<change><search><![CDATA[function test() {
	return true
}]]></search><replace><![CDATA[function test() {
	// Test function
	return true
}]]></replace></change><change><search><![CDATA[function other() {
	return false
}]]></search><replace><![CDATA[function other() {
	// Other function
	return false
}]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`function test() {
	// Test function
	return true
}

function other() {
	// Other function
	return false
}`)
		})

		it("should handle complex multi-line changes with CDATA", () => {
			const originalContent = `class Calculator {
	add(a, b) {
		return a + b
	}
}`
			const xmlResponse = `<change><search><![CDATA[class Calculator {
	add(a, b) {
		return a + b
	}
}]]></search><replace><![CDATA[class Calculator {
	/**
	 * Add two numbers
	 */
	add(a, b) {
		const result = a + b
		console.log('Result:', result)
		return result
	}
}]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`class Calculator {
	/**
	 * Add two numbers
	 */
	add(a, b) {
		const result = a + b
		console.log('Result:', result)
		return result
	}
}`)
		})

		it("should handle changes with nested XML-like content", () => {
			const originalContent = `const template = "<div></div>"`
			const xmlResponse = `<change><search><![CDATA[const template = "<div></div>"]]></search><replace><![CDATA[const template = "<div><span>Hello</span></div>"]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`const template = "<div><span>Hello</span></div>"`)
		})

		it("should handle sequential operations on adjacent lines", () => {
			const originalContent = `const a = 1
const b = 2
const c = 3`
			const xmlResponse = `<change><search><![CDATA[const a = 1
const b = 2
const c = 3]]></search><replace><![CDATA[const a = 10
const b = 20
const c = 30]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`const a = 10
const b = 20
const c = 30`)
		})
	})

	describe("realistic code transformation scenarios", () => {
		/**
		 * Test realistic refactoring: Converting callback to async/await
		 */
		it("should handle callback to async/await refactoring", () => {
			const originalContent = `function fetchData(callback) {
	getData((err, data) => {
		if (err) {
			callback(err)
		} else {
			callback(null, data)
		}
	})
}`
			const xmlResponse = `<change><search><![CDATA[function fetchData(callback) {
	getData((err, data) => {
		if (err) {
			callback(err)
		} else {
			callback(null, data)
		}
	})
}]]></search><replace><![CDATA[async function fetchData() {
	try {
		const data = await getData()
		return data
	} catch (err) {
		throw err
	}
}]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`async function fetchData() {
	try {
		const data = await getData()
		return data
	} catch (err) {
		throw err
	}
}`)
		})

		/**
		 * Test realistic refactoring: Adding error handling
		 */
		it("should handle adding error handling to existing code", () => {
			const originalContent = `function processData(data) {
	const result = transform(data)
	return result
}`
			const xmlResponse = `<change><search><![CDATA[function processData(data) {
	const result = transform(data)
	return result
}]]></search><replace><![CDATA[function processData(data) {
	try {
		const result = transform(data)
		return result
	} catch (error) {
		console.error('Error processing data:', error)
		throw error
	}
}]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`function processData(data) {
	try {
		const result = transform(data)
		return result
	} catch (error) {
		console.error('Error processing data:', error)
		throw error
	}
}`)
		})

		/**
		 * Test realistic refactoring: Adding TypeScript types
		 */
		it("should handle adding TypeScript type annotations", () => {
			const originalContent = `function add(a, b) {
	return a + b
}`
			const xmlResponse = `<change><search><![CDATA[function add(a, b) {
	return a + b
}]]></search><replace><![CDATA[function add(a: number, b: number): number {
	return a + b
}]]></replace></change>`

			const result = strategyTester.parseCompletion(originalContent, xmlResponse)

			expect(result).toBe(`function add(a: number, b: number): number {
	return a + b
}`)
		})
	})
})
