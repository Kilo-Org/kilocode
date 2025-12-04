import { describe, expect, it } from "vitest"
import { getSymbolsForFile } from "./treeSitter"

// vibecoded
describe("getSymbolsForFile", () => {
	it("should extract symbols from Python code", async () => {
		const filepath = "test.py"
		const contents = `def greet(name):
    return f"Hello, {name}!"

class Calculator:
    def add(self, a, b):
        return a + b
`

		const symbols = await getSymbolsForFile(filepath, contents)

		// Verify we get symbols
		expect(symbols).toBeDefined()
		expect(symbols!.length).toBeGreaterThan(0)

		// Verify function symbol
		const greetSymbol = symbols?.find((s) => s.name === "greet")
		expect(greetSymbol).toBeDefined()
		expect(greetSymbol?.type).toBe("function_definition")
		expect(greetSymbol?.filepath).toBe(filepath)
		expect(greetSymbol?.range.start.line).toBe(0)
		expect(greetSymbol?.content).toContain("def greet")

		// Verify class symbol
		const calculatorSymbol = symbols?.find((s) => s.name === "Calculator")
		expect(calculatorSymbol).toBeDefined()
		expect(calculatorSymbol?.type).toBe("class_definition")
		expect(calculatorSymbol?.content).toContain("class Calculator")
	})
})
