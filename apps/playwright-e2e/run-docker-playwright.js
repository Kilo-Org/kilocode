#!/usr/bin/env node

/**
 * Streamlined Docker orchestration for Playwright testing
 * Builds entire app outside Docker, installs only Playwright deps inside
 */

import { spawn } from "child_process"
import fs from "fs-extra"
import path from "path"
import { fileURLToPath } from "url"
import pkg from "signale"
const { Signale } = pkg

// --- Configuration

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, "../..")
const IMAGE_NAME = "playwright-ci:latest"

const log = new Signale({
	types: {
		status: { badge: "🔧", color: "blue", label: "status" },
		success: { badge: "✅", color: "green", label: "success" },
		error: { badge: "❌", color: "red", label: "error" },
		warning: { badge: "⚠️", color: "yellow", label: "warning" },
	},
})

// ---

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const activeProcesses = new Set()

// Helper function to run commands
function runCommand(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: options.stdio || "inherit",
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
		})

		activeProcesses.add(child)

		let stdout = ""
		let stderr = ""

		if (child.stdout) {
			child.stdout.on("data", (data) => {
				stdout += data.toString()
			})
		}

		if (child.stderr) {
			child.stderr.on("data", (data) => {
				stderr += data.toString()
			})
		}

		child.on("close", (code) => {
			activeProcesses.delete(child)

			if (code === 0) {
				resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
			} else {
				reject(new Error(`Command failed with exit code ${code}: ${stderr || stdout}`))
			}
		})

		child.on("error", (error) => {
			activeProcesses.delete(child)
			reject(error)
		})
	})
}

// Function to kill all active child processes
function killAllChildProcesses() {
	if (activeProcesses.size > 0) {
		console.log(`\n🛑 Terminating ${activeProcesses.size} active child process(es)...`)

		for (const child of activeProcesses) {
			try {
				child.kill("SIGTERM")

				setTimeout(() => {
					if (!child.killed) {
						child.kill("SIGKILL")
					}
				}, 5000)
			} catch (_error) {}
		}

		activeProcesses.clear()
	}
}

// Help text
function showHelp() {
	console.log(`
🚀 Streamlined Docker Playwright Runner

Usage:
  node run-docker-playwright.js [playwright-args...]

Examples:
  node run-docker-playwright.js                        # Run all tests
  node run-docker-playwright.js tests/sanity.test.ts   # Run specific test
  node run-docker-playwright.js --grep "login"         # Run tests matching pattern
`)
}

// Check for help flag
if (process.argv.includes("--help") || process.argv.includes("-h")) {
	showHelp()
	process.exit(0)
}

async function validateEnvironment() {
	log.status("Validating environment...")

	if (!process.env.OPENROUTER_API_KEY) {
		log.error("OPENROUTER_API_KEY environment variable is not set")
		console.log('Please set it with: export OPENROUTER_API_KEY="your-api-key-here"')
		process.exit(1)
	}

	try {
		await runCommand("docker", ["--version"], { stdio: "pipe" })
	} catch {
		log.error("Docker is not available. Please install Docker first.")
		process.exit(1)
	}

	log.success("Environment validation passed")
}

async function buildHostArtifacts() {
	log.status("Building host artifacts...")

	process.chdir(WORKSPACE_ROOT)
	log.status(process.cwd())

	log.status("Installing dependencies...")
	await runCommand("pnpm", ["install", "--frozen-lockfile"], { cwd: WORKSPACE_ROOT })

	log.status("Building everything...")
	await runCommand("pnpm", ["-w", "run", "build"], { cwd: WORKSPACE_ROOT })

	log.success("Host artifacts built successfully")
}

async function buildDockerImage() {
	log.status("Building Docker image...")

	const buildArgs = [
		"buildx",
		"build",
		"-f",
		path.join(__dirname, "Dockerfile.playwright-ci"),
		"-t",
		IMAGE_NAME,
		"--load", // Load the image into Docker daemon
	]

	// Add cache arguments if running in CI
	if (process.env.CI) {
		buildArgs.push(
			"--cache-from",
			"type=local,src=/tmp/.buildx-cache",
			"--cache-to",
			"type=local,dest=/tmp/.buildx-cache,mode=max",
		)
	}

	buildArgs.push(WORKSPACE_ROOT)

	await runCommand("docker", buildArgs)

	log.success("Docker image built successfully")
}

async function runPlaywrightTests() {
	log.status("Running Playwright tests in Docker...")

	// Ensure and clean output directories
	const testResultsDir = path.join(__dirname, "test-results")
	const reportDir = path.join(__dirname, "playwright-report")

	await fs.ensureDir(testResultsDir)
	await fs.ensureDir(reportDir)
	await fs.emptyDir(testResultsDir)
	await fs.emptyDir(reportDir)

	// Ensure Docker cache directory exists
	const dockerCacheDir = path.join(WORKSPACE_ROOT, ".docker-cache")
	await fs.ensureDir(dockerCacheDir)

	// Docker run arguments
	const dockerArgs = [
		"run",
		"--rm",
		"--cap-add=IPC_LOCK", // Required for keyring memory operations
		"-v",
		`${WORKSPACE_ROOT}:/workspace`,
		"-v",
		`${WORKSPACE_ROOT}/node_modules:/workspace/node_modules:ro`,
		"-v",
		`${WORKSPACE_ROOT}/apps/playwright-e2e/node_modules:/workspace/apps/playwright-e2e/node_modules:ro`,
		"-v",
		`${dockerCacheDir}:/workspace/.docker-cache`,
		"-e",
		"OPENROUTER_API_KEY",
		"-e",
		"CI=true",
		"-e",
		"GNOME_KEYRING_CONTROL=1", // Enable keyring support
		IMAGE_NAME,
	]

	// Add test arguments - pass through all arguments as Playwright test args
	const testArgs = process.argv.slice(2).filter((arg) => !["--help", "-h"].includes(arg))
	dockerArgs.push(...testArgs)

	await runCommand("docker", dockerArgs)

	log.success("Playwright tests completed successfully!")
	console.log("\n📊 Test Results:")
	console.log(`  • Test results: ${testResultsDir}`)
	console.log(`  • HTML report: ${reportDir}`)
}

// Main execution
async function main() {
	console.log(`📁 Workspace: ${WORKSPACE_ROOT}\n`)

	try {
		await validateEnvironment()

		await buildHostArtifacts()
		await buildDockerImage()

		await runPlaywrightTests()

		console.log("\n🎉 All done!")
	} catch (error) {
		log.error(`Failed: ${error.message}`)
		process.exit(1)
	}
}

// Graceful shutdown
process.on("SIGTERM", () => {
	log.warning("Received SIGTERM, shutting down gracefully")
	killAllChildProcesses()
	process.exit(0)
})

process.on("SIGINT", () => {
	log.warning("Received SIGINT (Ctrl+C), shutting down gracefully")
	killAllChildProcesses()
	process.exit(0)
})

// Handle uncaught exceptions to ensure cleanup
process.on("uncaughtException", (error) => {
	log.error(`Uncaught exception: ${error.message}`)
	killAllChildProcesses()
	process.exit(1)
})

process.on("unhandledRejection", (reason, promise) => {
	log.error(`Unhandled rejection at: ${promise}, reason: ${reason}`)
	killAllChildProcesses()
	process.exit(1)
})

main()
