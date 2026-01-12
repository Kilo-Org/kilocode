// kilocode_change - new file
/**
 * TypeScript Parser Tests
 */

import { TypeScriptParser } from "../typescript-parser"
import { CodeEntity, EntityRelationship } from "../../types"

describe("TypeScriptParser", () => {
	let parser: TypeScriptParser

	beforeEach(() => {
		parser = new TypeScriptParser()
	})

	describe("canParse", () => {
		it("should return true for TypeScript files", () => {
			expect(parser.canParse("/path/to/file.ts")).toBe(true)
			expect(parser.canParse("/path/to/file.tsx")).toBe(true)
		})

		it("should return true for JavaScript files", () => {
			expect(parser.canParse("/path/to/file.js")).toBe(true)
			expect(parser.canParse("/path/to/file.jsx")).toBe(true)
			expect(parser.canParse("/path/to/file.mjs")).toBe(true)
		})

		it("should return false for unsupported files", () => {
			expect(parser.canParse("/path/to/file.py")).toBe(false)
			expect(parser.canParse("/path/to/file.java")).toBe(false)
			expect(parser.canParse("/path/to/file.txt")).toBe(false)
		})
	})

	describe("parse - functions", () => {
		it("should extract function declarations", async () => {
			const content = `
function hello(name: string): string {
  return "Hello, " + name;
}

export async function fetchData(url: string): Promise<Response> {
  return fetch(url);
}
`
			const result = await parser.parse("/test/file.ts", content)

			expect(result.success).toBe(true)
			expect(result.entities.length).toBeGreaterThanOrEqual(2)

			const hello = result.entities.find((e) => e.name === "hello")
			expect(hello).toBeDefined()
			expect(hello?.type).toBe("function")
			expect(hello?.metadata.isAsync).toBe(false)

			const fetchData = result.entities.find((e) => e.name === "fetchData")
			expect(fetchData).toBeDefined()
			expect(fetchData?.type).toBe("function")
			expect(fetchData?.metadata.isAsync).toBe(true)
			expect(fetchData?.metadata.isExported).toBe(true)
		})

		it("should extract arrow functions", async () => {
			const content = `
export const add = (a: number, b: number): number => {
  return a + b;
}

const multiply = async (a: number, b: number) => a * b;
`
			const result = await parser.parse("/test/file.ts", content)

			expect(result.success).toBe(true)

			const add = result.entities.find((e) => e.name === "add")
			expect(add).toBeDefined()
			expect(add?.type).toBe("function")
			expect(add?.metadata.isArrowFunction).toBe(true)
		})
	})

	describe("parse - classes", () => {
		it("should extract class declarations", async () => {
			const content = `
export class UserService {
  private users: User[] = [];

  public async getUser(id: string): Promise<User | null> {
    return this.users.find(u => u.id === id) || null;
  }

  protected addUser(user: User): void {
    this.users.push(user);
  }
}
`
			const result = await parser.parse("/test/file.ts", content)

			expect(result.success).toBe(true)

			const userService = result.entities.find((e) => e.name === "UserService")
			expect(userService).toBeDefined()
			expect(userService?.type).toBe("class")
			expect(userService?.metadata.isExported).toBe(true)
		})

		it("should extract class inheritance", async () => {
			const content = `
class Animal {
  name: string;
}

class Dog extends Animal implements Pet {
  bark(): void {}
}
`
			const result = await parser.parse("/test/file.ts", content)

			expect(result.success).toBe(true)

			const dog = result.entities.find((e) => e.name === "Dog")
			expect(dog).toBeDefined()
			expect(dog?.metadata.extends).toBe("Animal")

			// Check for extends relationship
			const extendsRel = result.relationships.find((r) => r.type === "extends" && r.sourceId.includes("Dog"))
			expect(extendsRel).toBeDefined()
		})
	})

	describe("parse - interfaces", () => {
		it("should extract interface declarations", async () => {
			const content = `
export interface User {
  id: string;
  name: string;
  email: string;
}

interface Config {
  apiUrl: string;
  timeout: number;
}
`
			const result = await parser.parse("/test/file.ts", content)

			expect(result.success).toBe(true)

			const user = result.entities.find((e) => e.name === "User")
			expect(user).toBeDefined()
			expect(user?.type).toBe("interface")
			expect(user?.metadata.isExported).toBe(true)

			const config = result.entities.find((e) => e.name === "Config")
			expect(config).toBeDefined()
			expect(config?.type).toBe("interface")
		})
	})

	describe("parse - types", () => {
		it("should extract type declarations", async () => {
			const content = `
export type UserId = string;

type Status = 'active' | 'inactive' | 'pending';

export type UserWithStatus = User & { status: Status };
`
			const result = await parser.parse("/test/file.ts", content)

			expect(result.success).toBe(true)

			const userId = result.entities.find((e) => e.name === "UserId")
			expect(userId).toBeDefined()
			expect(userId?.type).toBe("type")

			const status = result.entities.find((e) => e.name === "Status")
			expect(status).toBeDefined()
			expect(status?.type).toBe("type")
		})
	})

	describe("parse - imports", () => {
		it("should extract import statements", async () => {
			const content = `
import { User, Config } from './types';
import * as utils from '../utils';
import defaultExport from 'some-module';
`
			const result = await parser.parse("/test/file.ts", content)

			expect(result.success).toBe(true)

			const imports = result.entities.filter((e) => e.type === "import")
			expect(imports.length).toBeGreaterThanOrEqual(3)

			const typesImport = imports.find((e) => e.name === "./types")
			expect(typesImport).toBeDefined()
			expect(typesImport?.metadata.namedImports).toContain("User")
			expect(typesImport?.metadata.namedImports).toContain("Config")
		})
	})

	describe("parse - exports", () => {
		it("should extract named exports", async () => {
			const content = `
const a = 1;
const b = 2;

export { a, b };
`
			const result = await parser.parse("/test/file.ts", content)

			expect(result.success).toBe(true)

			const exports = result.entities.filter((e) => e.type === "export")
			expect(exports.length).toBeGreaterThanOrEqual(1)
		})

		it("should extract re-exports", async () => {
			const content = `
export * from './types';
export * as utils from './utils';
`
			const result = await parser.parse("/test/file.ts", content)

			expect(result.success).toBe(true)

			const reExports = result.entities.filter((e) => e.type === "export" && e.metadata.isReExport)
			expect(reExports.length).toBeGreaterThanOrEqual(2)
		})
	})

	describe("parse - relationships", () => {
		it("should create call relationships", async () => {
			const content = `
function helper(): void {
  console.log("helper");
}

function main(): void {
  helper();
}
`
			const result = await parser.parse("/test/file.ts", content)

			expect(result.success).toBe(true)

			const callRel = result.relationships.find((r) => r.type === "calls")
			expect(callRel).toBeDefined()
		})

		it("should create import relationships", async () => {
			const content = `
import { something } from './other';
`
			const result = await parser.parse("/test/file.ts", content)

			expect(result.success).toBe(true)

			const importRel = result.relationships.find((r) => r.type === "imports")
			expect(importRel).toBeDefined()
		})
	})

	describe("error handling", () => {
		it("should handle empty content", async () => {
			const result = await parser.parse("/test/file.ts", "")

			expect(result.success).toBe(true)
			expect(result.entities.length).toBe(0)
		})

		it("should handle content with only comments", async () => {
			const content = `
// This is a comment
/* Multi-line
   comment */
`
			const result = await parser.parse("/test/file.ts", content)

			expect(result.success).toBe(true)
			expect(result.entities.length).toBe(0)
		})
	})
})
