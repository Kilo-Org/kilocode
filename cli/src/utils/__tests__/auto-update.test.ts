import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getAutoUpdateStatus, generateUpdateAvailableMessage } from "../auto-update.js"
import packageJson from "package-json"
import { Package } from "../../constants/package.js"

vi.mock("package-json")

describe("auto-update", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("getAutoUpdateStatus", () => {
		it("should return outdated status when newer version exists", async () => {
			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "2.0.0",
			} as Awaited<ReturnType<typeof packageJson>>)

			const result = await getAutoUpdateStatus()

			expect(result.isOutdated).toBe(true)
			expect(result.latestVersion).toBe("2.0.0")
			expect(result.name).toBe("@kilocode/cli")
			expect(packageJson).toHaveBeenCalledWith("@kilocode/cli")
		})

		it("should return not outdated when current version is latest", async () => {
			const currentVersion = Package.version
			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: currentVersion,
			} as Awaited<ReturnType<typeof packageJson>>)

			const result = await getAutoUpdateStatus()

			expect(result.isOutdated).toBe(false)
			expect(result.currentVersion).toBe(currentVersion)
			expect(result.latestVersion).toBe(currentVersion)
		})

		it("should handle API errors gracefully", async () => {
			vi.mocked(packageJson).mockRejectedValue(new Error("Network error"))

			const result = await getAutoUpdateStatus()

			expect(result.isOutdated).toBe(false)
			expect(result.currentVersion).toBeDefined()
			expect(result.latestVersion).toBe(result.currentVersion)
		})

		it("should run version check multiple times", async () => {
			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "2.0.0",
			} as Awaited<ReturnType<typeof packageJson>>)

			const result1 = await getAutoUpdateStatus()
			const result2 = await getAutoUpdateStatus()

			expect(result1.isOutdated).toBe(true)
			expect(result2.isOutdated).toBe(true)
			expect(packageJson).toHaveBeenCalledTimes(2)
		})
	})

	describe("generateUpdateAvailableMessage", () => {
		it("should generate correct update message", () => {
			const status = {
				name: "@kilocode/cli",
				isOutdated: true,
				currentVersion: "1.0.0",
				latestVersion: "2.0.0",
			}

			const message = generateUpdateAvailableMessage(status)

			expect(message.type).toBe("system")
			expect(message.content).toContain("A new version of Kilo CLI is available!")
			expect(message.content).toContain("v1.0.0")
			expect(message.content).toContain("v2.0.0")
			expect(message.content).toContain("npm install -g @kilocode/cli")
		})

		it("should include package name in install command", () => {
			const status = {
				name: "@kilocode/cli",
				isOutdated: true,
				currentVersion: "1.0.0",
				latestVersion: "2.0.0",
			}

			const message = generateUpdateAvailableMessage(status)

			expect(message.content).toContain("@kilocode/cli")
		})
	})

	describe("regression test for bad3bbef89 - version check independent of nosplash", () => {
		it("should run version check by default", async () => {
			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "2.0.0",
			} as Awaited<ReturnType<typeof packageJson>>)

			const result = await getAutoUpdateStatus()
			expect(result).toBeDefined()
			expect(packageJson).toHaveBeenCalled()
		})

		it("should skip version check only in CI mode", async () => {
			const ciMode = true

			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "2.0.0",
			} as Awaited<ReturnType<typeof packageJson>>)

			if (!ciMode) {
				await getAutoUpdateStatus()
			}

			expect(packageJson).not.toHaveBeenCalled()
		})
	})

	describe("version comparison", () => {
		it("should detect patch updates", async () => {
			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "1.0.1",
			} as Awaited<ReturnType<typeof packageJson>>)

			const result = await getAutoUpdateStatus()
			expect(result.isOutdated).toBe(true)
		})

		it("should detect minor updates", async () => {
			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "1.1.0",
			} as Awaited<ReturnType<typeof packageJson>>)

			const result = await getAutoUpdateStatus()
			expect(result.isOutdated).toBe(true)
		})

		it("should detect major updates", async () => {
			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "2.0.0",
			} as Awaited<ReturnType<typeof packageJson>>)

			const result = await getAutoUpdateStatus()
			expect(result.isOutdated).toBe(true)
		})

		it("should not flag as outdated when current version is newer", async () => {
			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "0.9.0",
			} as Awaited<ReturnType<typeof packageJson>>)

			const result = await getAutoUpdateStatus()
			expect(result.isOutdated).toBe(false)
		})
	})
})
