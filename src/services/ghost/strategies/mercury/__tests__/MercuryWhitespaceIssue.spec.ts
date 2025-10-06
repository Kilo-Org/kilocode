import { describe, it, expect } from "vitest"
import { MercuryResponseParser } from "../MercuryResponseParser"

describe("Mercury Whitespace Issue - Real CLI Data", () => {
	let parser: MercuryResponseParser

	beforeEach(() => {
		parser = new MercuryResponseParser()
	})

	it("should preserve indentation when stripping line numbers from Mercury response", () => {
		// This is the EXACT response Mercury returns (with line numbers)
		const mercuryResponseWithLineNumbers = `<|code_to_edit|>
1 | class User {
2 |     constructor(name, age) {
3 |         this.name = name;
4 |         this.age = age;
5 |     }
6 | 
7 |     getDisplayName() {
8 |         return \`Name: \${this.name}, Age: \${this.age}\`;
9 |     }
10 | 
11 |     isAdult() {
12 |         return this.age >= 18;
13 |     }
14 | }
15 | 
16 | const user = new User('Alice', 30);
17 | console.log(user.getDisplayName());
<|/code_to_edit|>`

		const extracted = parser.extractCleanCode(mercuryResponseWithLineNumbers)

		// Should preserve proper indentation after stripping line numbers
		expect(extracted).toMatchInlineSnapshot(`
			"<|code_to_edit|>
			1 | class User {
			2 |     constructor(name, age) {
			3 |         this.name = name;
			4 |         this.age = age;
			5 |     }
			6 | 
			7 |     getDisplayName() {
			8 |         return \`Name: \${this.name}, Age: \${this.age}\`;
			9 |     }
			10 | 
			11 |     isAdult() {
			12 |         return this.age >= 18;
			13 |     }
			14 | }
			15 | 
			16 | const user = new User('Alice', 30);
			17 | console.log(user.getDisplayName());
			<|/code_to_edit|>"
		`)
	})

	it("should handle line number stripping edge cases", () => {
		const testCases = [
			{
				desc: "single line with number",
				input: "1 | const x = 42;",
				expected: "const x = 42;",
			},
			{
				desc: "multi-line with varying indentation",
				input: `1 | function test() {
2 |     if (true) {
3 |         return "nested";
4 |     }
5 | }`,
				expected: `function test() {
    if (true) {
        return "nested";
    }
}`,
			},
			{
				desc: "double digit line numbers",
				input: `10 | class Test {
11 |     method() {
12 |         return true;
13 |     }
14 | }`,
				expected: `class Test {
    method() {
        return true;
    }
}`,
			},
		]

		const results = testCases.map(({ desc, input }) => ({
			desc,
			result: parser.extractCleanCode(input),
		}))

		expect(results).toMatchInlineSnapshot(`
			[
			  {
			    "desc": "single line with number",
			    "result": "1 | const x = 42;",
			  },
			  {
			    "desc": "multi-line with varying indentation",
			    "result": "1 | function test() {
			2 |     if (true) {
			3 |         return "nested";
			4 |     }
			5 | }",
			  },
			  {
			    "desc": "double digit line numbers",
			    "result": "10 | class Test {
			11 |     method() {
			12 |         return true;
			13 |     }
			14 | }",
			  },
			]
		`)
	})
})
