/**
 * Integration tests for CLI
 *
 * These tests require:
 * 1. RUN_CLI_INTEGRATION_TESTS=true environment variable (opt-in)
 * 2. A valid OPENROUTER_API_KEY environment variable
 * 3. A built CLI at apps/cli/dist (will auto-build if missing)
 * 4. A built extension at src/dist (will auto-build if missing)
 *
 * Run with: RUN_CLI_INTEGRATION_TESTS=true OPENROUTER_API_KEY=sk-or-v1-... pnpm test
 */

// pnpm --filter @roo-code/cli test src/__tests__/index.test.ts

import path from "path"
import fs from "fs"
import { execSync, spawn, type ChildProcess } from "child_process"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const RUN_INTEGRATION_TESTS = process.env.RUN_CLI_INTEGRATION_TESTS === "true"
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const hasApiKey = !!OPENROUTER_API_KEY

function findCliRoot(): string {
	// From apps/cli/src/__tests__, go up to apps/cli.
	return path.resolve(__dirname, "../..")
}

function findMonorepoRoot(): string {
	// From apps/cli/src/__tests__, go up to monorepo root.
	return path.resolve(__dirname, "../../../..")
}

function isCliBuilt(): boolean {
	return fs.existsSync(path.join(findCliRoot(), "dist", "index.js"))
}

function isExtensionBuilt(): boolean {
	const monorepoRoot = findMonorepoRoot()
	const extensionPath = path.join(monorepoRoot, "src/dist")
	return fs.existsSync(path.join(extensionPath, "extension.js"))
}

function buildCliIfNeeded(): void {
	if (!isCliBuilt()) {
		execSync("pnpm build", { cwd: findCliRoot(), stdio: "inherit" })
		console.log("CLI build complete.")
	}
}

function buildExtensionIfNeeded(): void {
	if (!isExtensionBuilt()) {
		execSync("pnpm --filter roo-cline bundle", { cwd: findMonorepoRoot(), stdio: "inherit" })
		console.log("Extension build complete.")
	}
}

function runCli(
	args: string[],
	options: { timeout?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return new Promise((resolve) => {
		const timeout = options.timeout ?? 60000

		let stdout = ""
		let stderr = ""
		let timedOut = false

		const proc: ChildProcess = spawn("pnpm", ["start", ...args], {
			cwd: findCliRoot(),
			env: { ...process.env, OPENROUTER_API_KEY, NO_COLOR: "1", FORCE_COLOR: "0" },
			stdio: ["pipe", "pipe", "pipe"],
		})

		const timeoutId = setTimeout(() => {
			timedOut = true
			proc.kill("SIGTERM")
		}, timeout)

		proc.stdout?.on("data", (data: Buffer) => {
			stdout += data.toString()
		})

		proc.stderr?.on("data", (data: Buffer) => {
			stderr += data.toString()
		})

		proc.on("close", (code: number | null) => {
			clearTimeout(timeoutId)
			resolve({ stdout, stderr, exitCode: timedOut ? -1 : (code ?? 1) })
		})

		proc.on("error", (error: Error) => {
			clearTimeout(timeoutId)
			stderr += error.message
			resolve({ stdout, stderr, exitCode: 1 })
		})
	})
}

describe.skipIf(!RUN_INTEGRATION_TESTS || !hasApiKey)("CLI Integration Tests", () => {
	beforeAll(() => {
		buildExtensionIfNeeded()
		buildCliIfNeeded()
	})

	it("should complete end-to-end task execution via CLI", async () => {
		const result = await runCli(
			["--no-tui", "-m", "anthropic/claude-sonnet-4.5", "-M", "ask", "-r", "disabled", "-P", "1+1=?"],
			{ timeout: 30_000 },
		)

		console.log("CLI stdout:", result.stdout)

		if (result.stderr) {
			console.log("CLI stderr:", result.stderr)
		}

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("2")
		expect(result.stdout).toContain("[task complete]")
	}, 30_000)
})
