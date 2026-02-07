import fs from "fs"
import os from "os"
import path from "path"

import { getEsbuildScriptPath, runEsbuild, NODE_BUILTIN_MODULES, COMMONJS_REQUIRE_BANNER } from "../esbuild-runner.js"

describe("getEsbuildScriptPath", () => {
	it("should find esbuild-wasm script in node_modules in development", () => {
		const scriptPath = getEsbuildScriptPath()

		// Should find the script.
		expect(typeof scriptPath).toBe("string")
		expect(scriptPath.length).toBeGreaterThan(0)

		// The script should exist.
		expect(fs.existsSync(scriptPath)).toBe(true)

		// Should be the esbuild script (not a binary).
		expect(scriptPath).toMatch(/esbuild$/)
	})

	it("should prefer production path when extensionPath is provided and script exists", () => {
		// Create a temporary directory with a fake script.
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "esbuild-runner-test-"))
		const binDir = path.join(tempDir, "dist", "bin")
		fs.mkdirSync(binDir, { recursive: true })

		const fakeScriptPath = path.join(binDir, "esbuild")
		fs.writeFileSync(fakeScriptPath, "#!/usr/bin/env node\nconsole.log('fake esbuild')")

		try {
			const result = getEsbuildScriptPath(tempDir)
			expect(result).toBe(fakeScriptPath)
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	it("should fall back to node_modules when production script does not exist", () => {
		// Pass a non-existent extension path.
		const result = getEsbuildScriptPath("/nonexistent/extension/path")

		// Should fall back to development path.
		expect(typeof result).toBe("string")
		expect(result.length).toBeGreaterThan(0)
		expect(fs.existsSync(result)).toBe(true)
	})
})

describe("runEsbuild", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "esbuild-runner-test-"))
	})

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("should compile a TypeScript file to ESM", async () => {
		// Create a simple TypeScript file.
		const inputFile = path.join(tempDir, "input.ts")
		const outputFile = path.join(tempDir, "output.mjs")

		fs.writeFileSync(
			inputFile,
			`
				export const greeting = "Hello, World!"
				export function add(a: number, b: number): number {
					return a + b
				}
			`,
		)

		await runEsbuild({
			entryPoint: inputFile,
			outfile: outputFile,
			format: "esm",
			platform: "node",
			target: "node18",
			bundle: true,
		})

		// Verify output file exists.
		expect(fs.existsSync(outputFile)).toBe(true)

		// Verify output content is valid JavaScript.
		const outputContent = fs.readFileSync(outputFile, "utf-8")
		expect(outputContent).toContain("Hello, World!")
		expect(outputContent).toContain("add")
	}, 30000)

	it("should generate inline source maps when specified", async () => {
		const inputFile = path.join(tempDir, "input.ts")
		const outputFile = path.join(tempDir, "output.mjs")

		fs.writeFileSync(inputFile, `export const value = 42`)

		await runEsbuild({ entryPoint: inputFile, outfile: outputFile, format: "esm", sourcemap: "inline" })

		const outputContent = fs.readFileSync(outputFile, "utf-8")
		expect(outputContent).toContain("sourceMappingURL=data:")
	}, 30000)

	it("should throw an error for invalid TypeScript", async () => {
		const inputFile = path.join(tempDir, "invalid.ts")
		const outputFile = path.join(tempDir, "output.mjs")

		// Write syntactically invalid TypeScript.
		fs.writeFileSync(inputFile, `export const value = {{{ invalid syntax`)

		await expect(runEsbuild({ entryPoint: inputFile, outfile: outputFile, format: "esm" })).rejects.toThrow()
	}, 30000)

	it("should throw an error for non-existent file", async () => {
		const nonExistentFile = path.join(tempDir, "does-not-exist.ts")
		const outputFile = path.join(tempDir, "output.mjs")

		await expect(runEsbuild({ entryPoint: nonExistentFile, outfile: outputFile, format: "esm" })).rejects.toThrow()
	}, 30000)

	it("should bundle dependencies when bundle option is true", async () => {
		// Create two files where one imports the other.
		const libFile = path.join(tempDir, "lib.ts")
		const mainFile = path.join(tempDir, "main.ts")
		const outputFile = path.join(tempDir, "output.mjs")

		fs.writeFileSync(libFile, `export const PI = 3.14159`)
		fs.writeFileSync(
			mainFile,
			`
				import { PI } from "./lib.js"
				export const circumference = (r: number) => 2 * PI * r
			`,
		)

		await runEsbuild({ entryPoint: mainFile, outfile: outputFile, format: "esm", bundle: true })

		const outputContent = fs.readFileSync(outputFile, "utf-8")
		// The PI constant should be bundled inline.
		expect(outputContent).toContain("3.14159")
	}, 30000)

	it("should respect platform option", async () => {
		const inputFile = path.join(tempDir, "input.ts")
		const outputFile = path.join(tempDir, "output.mjs")

		fs.writeFileSync(inputFile, `export const value = process.env.NODE_ENV`)

		await runEsbuild({ entryPoint: inputFile, outfile: outputFile, format: "esm", platform: "node" })

		// File should be created successfully.
		expect(fs.existsSync(outputFile)).toBe(true)
	}, 30000)

	it("should keep external modules as imports instead of bundling", async () => {
		const inputFile = path.join(tempDir, "input.ts")
		const outputFile = path.join(tempDir, "output.mjs")

		// Write code that imports fs (a Node.js built-in).
		fs.writeFileSync(
			inputFile,
			`
				import fs from "fs"
				export function fileExists(p: string): boolean {
					return fs.existsSync(p)
				}
			`,
		)

		await runEsbuild({
			entryPoint: inputFile,
			outfile: outputFile,
			format: "esm",
			bundle: true,
			external: ["fs"],
		})

		const outputContent = fs.readFileSync(outputFile, "utf-8")
		// fs should remain as an import, not bundled.
		expect(outputContent).toMatch(/import.*from\s*["']fs["']/)
	}, 30000)

	it("should add banner code when specified", async () => {
		const inputFile = path.join(tempDir, "input.ts")
		const outputFile = path.join(tempDir, "output.mjs")

		fs.writeFileSync(inputFile, `export const greeting = "Hello"`)

		const customBanner = "// This is a custom banner comment"
		await runEsbuild({
			entryPoint: inputFile,
			outfile: outputFile,
			format: "esm",
			banner: customBanner,
		})

		const outputContent = fs.readFileSync(outputFile, "utf-8")
		// Banner should be at the start of the file.
		expect(outputContent.startsWith(customBanner)).toBe(true)
	}, 30000)

	it("should add CommonJS require shim banner for ESM bundles", async () => {
		const inputFile = path.join(tempDir, "input.ts")
		const outputFile = path.join(tempDir, "output.mjs")

		fs.writeFileSync(inputFile, `export const value = 42`)

		await runEsbuild({
			entryPoint: inputFile,
			outfile: outputFile,
			format: "esm",
			banner: COMMONJS_REQUIRE_BANNER,
		})

		const outputContent = fs.readFileSync(outputFile, "utf-8")
		// Should contain the createRequire shim.
		expect(outputContent).toContain("createRequire")
		expect(outputContent).toContain("import.meta.url")
	}, 30000)
})

describe("NODE_BUILTIN_MODULES", () => {
	it("should include common Node.js built-in modules", () => {
		expect(NODE_BUILTIN_MODULES).toContain("fs")
		expect(NODE_BUILTIN_MODULES).toContain("path")
		expect(NODE_BUILTIN_MODULES).toContain("crypto")
		expect(NODE_BUILTIN_MODULES).toContain("http")
		expect(NODE_BUILTIN_MODULES).toContain("https")
		expect(NODE_BUILTIN_MODULES).toContain("os")
		expect(NODE_BUILTIN_MODULES).toContain("child_process")
		expect(NODE_BUILTIN_MODULES).toContain("stream")
		expect(NODE_BUILTIN_MODULES).toContain("util")
		expect(NODE_BUILTIN_MODULES).toContain("events")
	})

	it("should be an array of strings", () => {
		expect(Array.isArray(NODE_BUILTIN_MODULES)).toBe(true)
		expect(NODE_BUILTIN_MODULES.every((m) => typeof m === "string")).toBe(true)
	})
})

describe("COMMONJS_REQUIRE_BANNER", () => {
	it("should provide createRequire shim", () => {
		expect(COMMONJS_REQUIRE_BANNER).toContain("createRequire")
		expect(COMMONJS_REQUIRE_BANNER).toContain("import.meta.url")
	})

	it("should define require variable", () => {
		expect(COMMONJS_REQUIRE_BANNER).toMatch(/var require\s*=/)
	})
})
