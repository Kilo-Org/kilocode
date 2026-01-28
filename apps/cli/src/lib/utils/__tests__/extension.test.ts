import fs from "fs"
import path from "path"

import { getDefaultExtensionPath } from "../extension.js"

vi.mock("fs")

describe("getDefaultExtensionPath", () => {
	const originalEnv = process.env

	beforeEach(() => {
		vi.resetAllMocks()
		// Reset process.env to avoid ROO_EXTENSION_PATH from installed CLI affecting tests.
		process.env = { ...originalEnv }
		delete process.env.ROO_EXTENSION_PATH
	})

	afterEach(() => {
		process.env = originalEnv
	})

	it("should return monorepo path when extension.js exists there", () => {
		const mockDirname = "/test/apps/cli/dist"
		const expectedMonorepoPath = path.resolve(mockDirname, "../../../src/dist")

		vi.mocked(fs.existsSync).mockReturnValue(true)

		const result = getDefaultExtensionPath(mockDirname)

		expect(result).toBe(expectedMonorepoPath)
		expect(fs.existsSync).toHaveBeenCalledWith(path.join(expectedMonorepoPath, "extension.js"))
	})

	it("should return package path when extension.js does not exist in monorepo path", () => {
		const mockDirname = "/test/apps/cli/dist"
		const expectedPackagePath = path.resolve(mockDirname, "../extension")

		vi.mocked(fs.existsSync).mockReturnValue(false)

		const result = getDefaultExtensionPath(mockDirname)

		expect(result).toBe(expectedPackagePath)
	})

	it("should check monorepo path first", () => {
		const mockDirname = "/some/path"
		vi.mocked(fs.existsSync).mockReturnValue(false)

		getDefaultExtensionPath(mockDirname)

		const expectedMonorepoPath = path.resolve(mockDirname, "../../../src/dist")
		expect(fs.existsSync).toHaveBeenCalledWith(path.join(expectedMonorepoPath, "extension.js"))
	})
})
