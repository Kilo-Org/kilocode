/**
 * Integration test helper utilities for Kilo Code CLI
 * Inspired by google-gemini/gemini-cli test infrastructure
 */

import { expect } from "vitest"
import { execSync } from "node:child_process"
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { env, stdout as processStdout } from "node:process"
import * as pty from "@lydell/node-pty"
import stripAnsi from "strip-ansi"
import { tmpdir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Get timeout based on environment
function getDefaultTimeout() {
	if (env["CI"]) return 60000 // 1 minute in CI
	return 15000 // 15s locally
}

/**
 * Poll a predicate function until it returns true or times out
 */
export async function poll(predicate: () => boolean, timeout: number, interval: number): Promise<boolean> {
	const startTime = Date.now()
	let attempts = 0
	while (Date.now() - startTime < timeout) {
		attempts++
		const result = predicate()
		if (env["VERBOSE"] === "true" && attempts % 5 === 0) {
			console.log(`Poll attempt ${attempts}: ${result ? "success" : "waiting..."}`)
		}
		if (result) {
			return true
		}
		await new Promise((resolve) => setTimeout(resolve, interval))
	}
	if (env["VERBOSE"] === "true") {
		console.log(`Poll timed out after ${attempts} attempts`)
	}
	return false
}

/**
 * Sanitize test name for use as directory name
 */
function sanitizeTestName(name: string) {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "-")
		.replace(/-+/g, "-")
}

/**
 * Interactive run helper for PTY-based testing
 */
export class InteractiveRun {
	ptyProcess: pty.IPty
	public output = ""

	constructor(ptyProcess: pty.IPty) {
		this.ptyProcess = ptyProcess
		ptyProcess.onData((data) => {
			this.output += data
			if (env["KEEP_OUTPUT"] === "true" || env["VERBOSE"] === "true") {
				processStdout.write(data)
			}
		})
	}

	/**
	 * Wait for specific text to appear in output
	 */
	async expectText(text: string, timeout?: number) {
		if (!timeout) {
			timeout = getDefaultTimeout()
		}
		const found = await poll(() => stripAnsi(this.output).toLowerCase().includes(text.toLowerCase()), timeout, 200)
		expect(found, `Did not find expected text: "${text}". Output was:\n${stripAnsi(this.output)}`).toBe(true)
	}

	/**
	 * Wait for a regex pattern to match in output
	 */
	async expectPattern(pattern: RegExp, timeout?: number) {
		if (!timeout) {
			timeout = getDefaultTimeout()
		}
		const found = await poll(() => pattern.test(stripAnsi(this.output)), timeout, 200)
		expect(found, `Did not find expected pattern: ${pattern}. Output was:\n${stripAnsi(this.output)}`).toBe(true)
	}

	/**
	 * Type text slowly (character by character) with echo verification
	 */
	async type(text: string) {
		let typedSoFar = ""
		for (const char of text) {
			this.ptyProcess.write(char)
			typedSoFar += char

			// Wait for the typed sequence to be echoed back
			const found = await poll(
				() => stripAnsi(this.output).includes(typedSoFar),
				5000, // 5s timeout per character
				10, // check frequently
			)

			if (!found) {
				throw new Error(
					`Timed out waiting for typed text to appear in output: "${typedSoFar}".\nStripped output:\n${stripAnsi(
						this.output,
					)}`,
				)
			}
		}
	}

	/**
	 * Simulate typing one character at a time to avoid paste detection
	 */
	async sendKeys(text: string) {
		const delay = 5
		for (const char of text) {
			this.ptyProcess.write(char)
			await new Promise((resolve) => setTimeout(resolve, delay))
		}
	}

	/**
	 * Press Enter key
	 */
	async pressEnter() {
		this.ptyProcess.write("\r")
		await new Promise((resolve) => setTimeout(resolve, 50))
	}

	/**
	 * Press Escape key
	 */
	async pressEscape() {
		this.ptyProcess.write("\x1b")
		await new Promise((resolve) => setTimeout(resolve, 50))
	}

	/**
	 * Send Ctrl+C
	 */
	async sendCtrlC() {
		this.ptyProcess.write("\x03")
		await new Promise((resolve) => setTimeout(resolve, 100))
	}

	/**
	 * Kill the process
	 */
	async kill() {
		this.ptyProcess.kill()
	}

	/**
	 * Wait for process to exit and return exit code
	 */
	expectExit(): Promise<number> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`Test timed out: process did not exit within a minute.`)),
				60000,
			)
			this.ptyProcess.onExit(({ exitCode }) => {
				clearTimeout(timer)
				resolve(exitCode)
			})
		})
	}

	/**
	 * Get stripped output (without ANSI codes)
	 */
	getStrippedOutput(): string {
		return stripAnsi(this.output)
	}
}

/**
 * Main test rig for setting up and running CLI integration tests
 */
export class TestRig {
	bundlePath: string
	testName: string
	testDir: string = ""
	sourceDir: string = ""

	constructor(testName: string) {
		this.bundlePath = join(__dirname, "..", "dist/index.js")
		this.testName = testName

		this.setupTestDir()
	}

	setupTestDir() {
		const sanitizedName = sanitizeTestName(this.testName)
		const baseDir = join(tmpdir(), "kilocode-cli-tests")
		this.testDir = join(baseDir, sanitizedName)

		mkdirSync(this.testDir, { recursive: true })

		this.sourceDir = join(this.testDir, "src")
		mkdirSync(this.sourceDir, { recursive: true })
	}

	/**
	 * Create a file in the test workspace
	 */
	createFile(fileName: string, content: string): string {
		const filePath = join(this.sourceDir, fileName)
		const fileDir = dirname(filePath)
		mkdirSync(fileDir, { recursive: true })
		writeFileSync(filePath, content)
		return filePath
	}

	/**
	 * Create a directory in the test workspace
	 */
	mkdir(dir: string) {
		mkdirSync(join(this.sourceDir, dir), { recursive: true })
	}

	/**
	 * Read a file from the test workspace
	 */
	readFile(fileName: string): string {
		const filePath = join(this.sourceDir, fileName)
		const content = readFileSync(filePath, "utf-8")
		if (env["KEEP_OUTPUT"] === "true" || env["VERBOSE"] === "true") {
			console.log(`--- FILE: ${filePath} ---`)
			console.log(content)
			console.log(`--- END FILE: ${filePath} ---`)
		}
		return content
	}

	/**
	 * Sync filesystem (useful before spawning)
	 */
	sync() {
		try {
			execSync("sync", { cwd: this.sourceDir })
		} catch {
			// sync may not be available on all platforms
		}
	}

	/**
	 * Get command and args for running the CLI
	 */
	private _getCommandAndArgs(extraInitialArgs: string[] = []): {
		command: string
		initialArgs: string[]
	} {
		const command = "node"
		const initialArgs = [this.bundlePath, ...extraInitialArgs]
		return { command, initialArgs }
	}

	/**
	 * Run CLI in interactive mode with PTY
	 */
	async runInteractive(
		extraArgs: string[] = [],
		options: {
			env?: Record<string, string>
			cols?: number
			rows?: number
		} = {},
	): Promise<InteractiveRun> {
		const { command, initialArgs } = this._getCommandAndArgs()
		const commandArgs = [...initialArgs, ...extraArgs]

		const ptyEnv = {
			// Keep colors so we can see the logo properly
			FORCE_COLOR: "1",
			KILO_EPHEMERAL_MODE: "true",
			KILO_DISABLE_SESSIONS: "true",
			KILO_PROVIDER_TYPE: "kilocode",
			KILOCODE_MODEL: "anthropic/claude-sonnet-4.5",
			KILOCODE_TOKEN: "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
			...process.env,
			...env,
			...options.env,
		} as { [key: string]: string }

		const ptyOptions: pty.IPtyForkOptions = {
			name: "xterm-color",
			cols: options.cols || 120,
			rows: options.rows || 30,
			cwd: this.testDir!,
			env: ptyEnv,
		}

		const executable = command === "node" ? process.execPath : command
		const ptyProcess = pty.spawn(executable, commandArgs, ptyOptions)

		const run = new InteractiveRun(ptyProcess)

		await poll(() => run.getStrippedOutput().includes("/help for commands"), 10_000, 100)

		await new Promise((resolve) => setTimeout(resolve, 1_000))

		return run
	}

	/**
	 * Clean up test directory
	 */
	async cleanup() {
		if (this.testDir && !env["KEEP_OUTPUT"]) {
			try {
				rmSync(this.testDir, { recursive: true, force: true })
			} catch (error) {
				if (env["VERBOSE"] === "true") {
					console.warn("Cleanup warning:", (error as Error).message)
				}
			}
		}
	}

	/**
	 * Check if the CLI bundle exists
	 */
	bundleExists(): boolean {
		return existsSync(this.bundlePath)
	}
}
