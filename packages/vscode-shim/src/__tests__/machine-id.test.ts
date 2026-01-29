import * as fs from "fs"
import * as path from "path"
import { tmpdir } from "os"

import { machineIdSync } from "../utils/machine-id.js"

describe("machineIdSync", () => {
	let originalHome: string | undefined
	let tempDir: string

	beforeEach(() => {
		originalHome = process.env.HOME
		tempDir = fs.mkdtempSync(path.join(tmpdir(), "machine-id-test-"))
		process.env.HOME = tempDir
	})

	afterEach(() => {
		process.env.HOME = originalHome
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true })
		}
	})

	it("should generate a machine ID", () => {
		const machineId = machineIdSync()

		expect(machineId).toBeDefined()
		expect(typeof machineId).toBe("string")
		expect(machineId.length).toBeGreaterThan(0)
	})

	it("should return a hexadecimal string", () => {
		const machineId = machineIdSync()

		// SHA256 hash produces 64 hex characters
		expect(machineId).toMatch(/^[a-f0-9]+$/)
		expect(machineId.length).toBe(64)
	})

	it("should persist machine ID to file", () => {
		const machineId = machineIdSync()

		const idPath = path.join(tempDir, ".vscode-mock", ".machine-id")
		expect(fs.existsSync(idPath)).toBe(true)

		const storedId = fs.readFileSync(idPath, "utf-8").trim()
		expect(storedId).toBe(machineId)
	})

	it("should return same ID on subsequent calls", () => {
		const machineId1 = machineIdSync()
		const machineId2 = machineIdSync()

		expect(machineId1).toBe(machineId2)
	})

	it("should read existing ID from file", () => {
		// Create the directory and file first
		const idDir = path.join(tempDir, ".vscode-mock")
		const idPath = path.join(idDir, ".machine-id")
		fs.mkdirSync(idDir, { recursive: true })
		fs.writeFileSync(idPath, "existing-machine-id-12345")

		const machineId = machineIdSync()

		expect(machineId).toBe("existing-machine-id-12345")
	})

	it("should create directory if it doesn't exist", () => {
		const idDir = path.join(tempDir, ".vscode-mock")

		expect(fs.existsSync(idDir)).toBe(false)

		machineIdSync()

		expect(fs.existsSync(idDir)).toBe(true)
	})

	it("should handle missing HOME environment variable", () => {
		// Use USERPROFILE instead (Windows fallback)
		delete process.env.HOME
		process.env.USERPROFILE = tempDir

		const machineId = machineIdSync()

		expect(machineId).toBeDefined()
		expect(machineId.length).toBeGreaterThan(0)

		// Restore
		process.env.HOME = tempDir
	})

	it("should generate unique IDs for different hosts", () => {
		// This test verifies that the ID generation includes random data
		// Since we can't easily change the hostname, we verify multiple generations
		// in fresh environments produce unique results (due to random component)

		// First call generates and saves
		const machineId1 = machineIdSync()

		// Delete the saved file to force regeneration
		const idPath = path.join(tempDir, ".vscode-mock", ".machine-id")
		fs.unlinkSync(idPath)

		// Second call should generate a new ID (random component)
		const machineId2 = machineIdSync()

		// The IDs should be different due to the random component
		expect(machineId1).not.toBe(machineId2)
	})

	it("should handle read errors gracefully", () => {
		// Create an unreadable file (directory instead of file)
		const idDir = path.join(tempDir, ".vscode-mock")
		const idPath = path.join(idDir, ".machine-id")
		fs.mkdirSync(idPath, { recursive: true }) // Create directory instead of file

		// Should not throw, should generate new ID
		expect(() => machineIdSync()).not.toThrow()

		const machineId = machineIdSync()
		expect(machineId).toBeDefined()
		expect(machineId.length).toBeGreaterThan(0)
	})

	it("should handle write errors gracefully", () => {
		// Make the directory read-only (Unix only)
		if (process.platform !== "win32") {
			const idDir = path.join(tempDir, ".vscode-mock")
			fs.mkdirSync(idDir, { recursive: true })
			fs.chmodSync(idDir, 0o444) // Read-only

			// Should not throw, should still generate ID
			expect(() => machineIdSync()).not.toThrow()

			const machineId = machineIdSync()
			expect(machineId).toBeDefined()

			// Restore permissions for cleanup
			fs.chmodSync(idDir, 0o755)
		}
	})
})
