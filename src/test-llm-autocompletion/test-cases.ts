export interface TestCase {
	name: string
	category: string
	input: string
	cursorPosition: { line: number; character: number }
	expectedPatterns: string[]
	description: string
}

export const testCases: TestCase[] = [
	// Basic Syntax Completions
	{
		name: "closing-brace",
		category: "Basic Syntax",
		input: `function test() {
  console.log('hello')<<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 1, character: 23 },
		expectedPatterns: ["}", "\\n}"],
		description: "Should complete closing brace for function",
	},
	{
		name: "semicolon",
		category: "Basic Syntax",
		input: `const x = 42<<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 0, character: 12 },
		expectedPatterns: [";"],
		description: "Should add semicolon after variable declaration",
	},
	{
		name: "closing-bracket",
		category: "Basic Syntax",
		input: `const arr = [1, 2, 3<<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 0, character: 20 },
		expectedPatterns: ["]"],
		description: "Should complete closing bracket for array",
	},
	{
		name: "closing-parenthesis",
		category: "Basic Syntax",
		input: `console.log('test'<<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 0, character: 18 },
		expectedPatterns: ["\\)"],
		description: "Should complete closing parenthesis for function call",
	},

	// Property and Method Access
	{
		name: "property-access",
		category: "Property Access",
		input: `const obj = { name: 'test', value: 42 };
obj.<<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 1, character: 4 },
		expectedPatterns: ["name", "value"],
		description: "Should suggest object properties",
	},
	{
		name: "array-method",
		category: "Method Access",
		input: `const arr = [1, 2, 3];
arr.<<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 1, character: 4 },
		expectedPatterns: ["map", "filter", "forEach", "push", "pop", "length"],
		description: "Should suggest array methods",
	},
	{
		name: "string-method",
		category: "Method Access",
		input: `const str = 'hello world';
str.<<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 1, character: 4 },
		expectedPatterns: ["substring", "charAt", "indexOf", "length", "toUpperCase", "toLowerCase"],
		description: "Should suggest string methods",
	},

	// Function Declarations and Calls
	{
		name: "function-body",
		category: "Function Declaration",
		input: `function calculateSum(a, b) <<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 0, character: 29 },
		expectedPatterns: ["{", "{\\n", "{\\s*\\n\\s*return a \\+ b"],
		description: "Should complete function body opening",
	},
	{
		name: "arrow-function",
		category: "Function Declaration",
		input: `const add = (a, b) <<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 0, character: 20 },
		expectedPatterns: ["=>", "=> {", "=> a \\+ b"],
		description: "Should complete arrow function syntax",
	},
	{
		name: "function-call-args",
		category: "Function Call",
		input: `function greet(name) { return 'Hello ' + name; }
greet(<<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 1, character: 6 },
		expectedPatterns: ["\\)", "'", '"'],
		description: "Should suggest function call argument completion",
	},

	// Variable Declarations and Assignments
	{
		name: "variable-assignment",
		category: "Variable Assignment",
		input: `const userName = <<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 0, character: 17 },
		expectedPatterns: ["'", '"', "null", "undefined"],
		description: "Should suggest common variable assignments",
	},
	{
		name: "array-declaration",
		category: "Variable Assignment",
		input: `const numbers = <<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 0, character: 16 },
		expectedPatterns: ["\\[", "\\[]"],
		description: "Should suggest array initialization",
	},
	{
		name: "object-declaration",
		category: "Variable Assignment",
		input: `const config = <<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 0, character: 15 },
		expectedPatterns: ["{", "{}", "{\\s*\\n"],
		description: "Should suggest object initialization",
	},

	// Import Statements
	{
		name: "import-from",
		category: "Import Statement",
		input: `import { useState } from <<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 0, character: 25 },
		expectedPatterns: ["'", '"', "'react'", '"react"'],
		description: "Should complete import module name",
	},
	{
		name: "import-curly-brace",
		category: "Import Statement",
		input: `import <<<AUTOCOMPLETE_HERE>>> from 'react'`,
		cursorPosition: { line: 0, character: 7 },
		expectedPatterns: ["{", "React", "\\* as"],
		description: "Should suggest import syntax options",
	},

	// Control Flow
	{
		name: "if-statement",
		category: "Control Flow",
		input: `const x = 10;
if (x > 5) <<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 1, character: 11 },
		expectedPatterns: ["{", "{\\n", "{\\s*\\n\\s*console.log"],
		description: "Should complete if statement body",
	},
	{
		name: "for-loop",
		category: "Control Flow",
		input: `for (let i = 0; i < 10; i++) <<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 0, character: 30 },
		expectedPatterns: ["{", "{\\n", "{\\s*\\n\\s*console.log"],
		description: "Should complete for loop body",
	},
	{
		name: "return-statement",
		category: "Control Flow",
		input: `function getValue() {
  return <<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 1, character: 9 },
		expectedPatterns: ["null", "undefined", "true", "false", "{", "\\["],
		description: "Should suggest return value completions",
	},

	// Complex Scenarios
	{
		name: "chained-methods",
		category: "Complex",
		input: `const result = [1, 2, 3]
  .map(x => x * 2)
  .<<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 2, character: 3 },
		expectedPatterns: ["filter", "reduce", "forEach", "map"],
		description: "Should suggest chained array methods",
	},
	{
		name: "nested-object",
		category: "Complex",
		input: `const config = {
  server: {
    port: 3000,
    <<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 3, character: 4 },
		expectedPatterns: ["host:", "hostname:", "}"],
		description: "Should suggest nested object properties",
	},
	{
		name: "async-await",
		category: "Complex",
		input: `async function fetchData() {
  const response = await <<<AUTOCOMPLETE_HERE>>>`,
		cursorPosition: { line: 1, character: 25 },
		expectedPatterns: ["fetch", "axios", "Promise"],
		description: "Should suggest async operations",
	},
]

// Helper function to find test cases by category
export function getTestCasesByCategory(category: string): TestCase[] {
	return testCases.filter((tc) => tc.category === category)
}

// Helper function to get all unique categories
export function getCategories(): string[] {
	return [...new Set(testCases.map((tc) => tc.category))]
}
