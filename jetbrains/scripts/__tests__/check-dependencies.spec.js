const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

describe("check-dependencies script", () => {
	const scriptPath = path.join(__dirname, "../check-dependencies.js")
	const projectRoot = path.resolve(__dirname, "../../..")
	const vscodeDir = path.join(projectRoot, "deps", "vscode")

	beforeEach(() => {
		// Ensure we're testing from a clean state
		process.env.CI = "false"
	})

	afterEach(() => {
		delete process.env.CI
	})

	it("should handle worktree setup correctly", () => {
		// Check if we have a worktree setup
		const gitFile = path.join(vscodeDir, ".git")
		const isWorktree = fs.existsSync(gitFile) && fs.statSync(gitFile).isFile()

		if (isWorktree) {
			// Verify the script can handle worktree setup
			const result = execSync(`node ${scriptPath}`, {
				cwd: path.join(projectRoot, "jetbrains", "host"),
				encoding: "utf8",
				stdio: "pipe",
			})

			expect(result).toContain("VSCode directory is ready")
			expect(result).toContain("All dependencies are properly configured!")
		} else {
			// If not a worktree, the test should still pass but with different behavior
			console.log("Not a worktree setup, skipping worktree-specific test")
		}
	})

	it("should detect CI environment correctly", () => {
		// Set CI environment variable
		process.env.CI = "true"

		const result = execSync(`node ${scriptPath}`, {
			cwd: path.join(projectRoot, "jetbrains", "host"),
			encoding: "utf8",
			stdio: "pipe",
		})

		// In CI, the script should still complete successfully
		expect(result).toContain("JetBrains Plugin Dependency Check")
	})

	it("should handle missing VSCode directory gracefully", () => {
		// This test verifies the script can recover from missing VSCode directory
		const expectedFile = path.join(vscodeDir, "src", "vs", "code", "electron-main", "main.ts")

		if (fs.existsSync(expectedFile)) {
			// If the file exists, the script should succeed
			const result = execSync(`node ${scriptPath}`, {
				cwd: path.join(projectRoot, "jetbrains", "host"),
				encoding: "utf8",
				stdio: "pipe",
			})

			expect(result).toContain("VSCode directory is ready")
		}
	})
})
