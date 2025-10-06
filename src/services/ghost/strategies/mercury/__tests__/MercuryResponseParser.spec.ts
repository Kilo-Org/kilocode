import { describe, it, expect } from "vitest"
import { MercuryResponseParser } from "../MercuryResponseParser"

describe("MercuryResponseParser", () => {
	let parser: MercuryResponseParser

	beforeEach(() => {
		parser = new MercuryResponseParser()
	})

	describe("extractCleanCode", () => {
		it("should extract code from markdown code blocks with language", () => {
			const response = `Here's the updated code:

\`\`\`javascript
function hello() {
		  console.log("Hello World");
}
\`\`\``

			const extracted = parser.extractCleanCode(response)
			expect(extracted).toMatchInlineSnapshot(`
				"function hello() {
						  console.log("Hello World");
				}"
			`)
		})

		it("should extract code from code blocks without language specifier", () => {
			const response = `\`\`\`
const x = 42;
const y = 13;
\`\`\``

			const extracted = parser.extractCleanCode(response)
			expect(extracted).toMatchInlineSnapshot(`
				"const x = 42;
				const y = 13;"
			`)
		})

		it("should handle Mercury markers if they leak through", () => {
			const response = `<|code_to_edit|>
function test() {
		  return true;
}
<|/code_to_edit|>`

			const extracted = parser.extractCleanCode(response)
			expect(extracted).toMatchInlineSnapshot(`
				"<|code_to_edit|>
				function test() {
						  return true;
				}
				<|/code_to_edit|>"
			`)
		})

		it("should handle combination of markdown and mercury markers", () => {
			const response = `\`\`\`javascript
<|code_to_edit|>
const value = "test";
<|/code_to_edit|>
\`\`\``

			const extracted = parser.extractCleanCode(response)
			expect(extracted).toMatchInlineSnapshot(`
				"<|code_to_edit|>
				const value = "test";
				<|/code_to_edit|>"
			`)
		})

		it("should return original content if no markers found", () => {
			const response = `function plain() { return 42; }`

			const extracted = parser.extractCleanCode(response)
			expect(extracted).toMatchInlineSnapshot(`"function plain() { return 42; }"`)
		})

		it("should preserve whitespace and indentation perfectly", () => {
			const response = `\`\`\`typescript
class User {
		  constructor(name, age) {
		      this.name = name;
		      this.age = age;
		  }

		  getDisplayName() {
		      return \`Name: \${this.name}, Age: \${this.age}\`;
		  }
}
\`\`\``

			const extracted = parser.extractCleanCode(response)
			expect(extracted).toMatchInlineSnapshot(`
				"class User {
						  constructor(name, age) {
						      this.name = name;
						      this.age = age;
						  }

						  getDisplayName() {
						      return \`Name: \${this.name}, Age: \${this.age}\`;
						  }
				}"
			`)
		})
	})

	describe("isEmpty and debug info", () => {
		it("should detect empty vs non-empty responses", () => {
			const testCases = [
				{ input: "", desc: "empty string" },
				{ input: "   \n\t  ", desc: "whitespace only" },
				{ input: "```\n\n```", desc: "empty code block" },
				{ input: "const x = 1;", desc: "plain code" },
				{ input: "```\nconst x = 1;\n```", desc: "code in block" },
			]

			const results = testCases.map(({ input, desc }) => ({
				desc,
				isEmpty: parser.isEmpty(input),
				debugInfo: parser.getParsingDebugInfo(input),
			}))

			expect(results).toMatchSnapshot()
		})
	})
})
