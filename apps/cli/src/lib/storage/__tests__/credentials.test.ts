import fs from "fs/promises"
import path from "path"

// Use vi.hoisted to make the test directory available to the mock
// This must return the path synchronously since CREDENTIALS_FILE is computed at import time
const { getTestConfigDir } = vi.hoisted(() => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const os = require("os")
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const path = require("path")
	const testRunId = Date.now().toString()
	const testConfigDir = path.join(os.tmpdir(), `roo-cli-test-${testRunId}`)
	return { getTestConfigDir: () => testConfigDir }
})

vi.mock("../config-dir.js", () => ({
	getConfigDir: getTestConfigDir,
}))

// Import after mocking
import { saveToken, loadToken, loadCredentials, clearToken, hasToken, getCredentialsPath } from "../credentials.js"

// Re-derive the test config dir for use in tests (must match the hoisted one)
const actualTestConfigDir = getTestConfigDir()

describe("Token Storage", () => {
	const expectedCredentialsFile = path.join(actualTestConfigDir, "cli-credentials.json")

	beforeEach(async () => {
		// Clear test directory before each test
		await fs.rm(actualTestConfigDir, { recursive: true, force: true })
	})

	afterAll(async () => {
		// Clean up test directory
		await fs.rm(actualTestConfigDir, { recursive: true, force: true })
	})

	describe("getCredentialsPath", () => {
		it("should return the correct credentials file path", () => {
			expect(getCredentialsPath()).toBe(expectedCredentialsFile)
		})
	})

	describe("saveToken", () => {
		it("should save token to disk", async () => {
			const token = "test-token-123"
			await saveToken(token)

			const savedData = await fs.readFile(expectedCredentialsFile, "utf-8")
			const credentials = JSON.parse(savedData)

			expect(credentials.token).toBe(token)
			expect(credentials.createdAt).toBeDefined()
		})

		it("should save token with user info", async () => {
			const token = "test-token-456"
			await saveToken(token, { userId: "user_123", orgId: "org_456" })

			const savedData = await fs.readFile(expectedCredentialsFile, "utf-8")
			const credentials = JSON.parse(savedData)

			expect(credentials.token).toBe(token)
			expect(credentials.userId).toBe("user_123")
			expect(credentials.orgId).toBe("org_456")
		})

		it("should create config directory if it doesn't exist", async () => {
			const token = "test-token-789"
			await saveToken(token)

			const dirStats = await fs.stat(actualTestConfigDir)
			expect(dirStats.isDirectory()).toBe(true)
		})

		// Unix file permissions don't apply on Windows - skip this test
		it.skipIf(process.platform === "win32")("should set restrictive file permissions", async () => {
			const token = "test-token-perms"
			await saveToken(token)

			const stats = await fs.stat(expectedCredentialsFile)
			// Check that only owner has read/write (mode 0o600)
			const mode = stats.mode & 0o777
			expect(mode).toBe(0o600)
		})
	})

	describe("loadToken", () => {
		it("should load saved token", async () => {
			const token = "test-token-abc"
			await saveToken(token)

			const loaded = await loadToken()
			expect(loaded).toBe(token)
		})

		it("should return null if no token exists", async () => {
			const loaded = await loadToken()
			expect(loaded).toBeNull()
		})
	})

	describe("loadCredentials", () => {
		it("should load full credentials", async () => {
			const token = "test-token-def"
			await saveToken(token, { userId: "user_789" })

			const credentials = await loadCredentials()

			expect(credentials).not.toBeNull()
			expect(credentials?.token).toBe(token)
			expect(credentials?.userId).toBe("user_789")
			expect(credentials?.createdAt).toBeDefined()
		})

		it("should return null if no credentials exist", async () => {
			const credentials = await loadCredentials()
			expect(credentials).toBeNull()
		})
	})

	describe("clearToken", () => {
		it("should remove saved token", async () => {
			const token = "test-token-ghi"
			await saveToken(token)

			await clearToken()

			const loaded = await loadToken()
			expect(loaded).toBeNull()
		})

		it("should not throw if no token exists", async () => {
			await expect(clearToken()).resolves.not.toThrow()
		})
	})

	describe("hasToken", () => {
		it("should return true if token exists", async () => {
			await saveToken("test-token-jkl")

			const exists = await hasToken()
			expect(exists).toBe(true)
		})

		it("should return false if no token exists", async () => {
			const exists = await hasToken()
			expect(exists).toBe(false)
		})
	})
})
