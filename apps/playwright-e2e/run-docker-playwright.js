#!/usr/bin/env node

/**
 * Streamlined Docker orchestration for Playwright testing
 * Builds entire app outside Docker, installs only Playwright deps inside
 */

import { execa } from "execa"
import fs from "fs-extra"
import path from "path"
import { fileURLToPath } from "url"
import { onExit } from "signal-exit"
import pkg from "signale"
const { Signale } = pkg

// --- Configuration

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, "../..")
const IMAGE_NAME = "playwright-ci:latest"

// ---

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let currentContainer = null
const log = new Signale()

// Check for help flag
if (process.argv.includes("--help") || process.argv.includes("-h")) {
	showHelp()
	process.exit(0)
}

// Single exit handler
onExit(async (code, signal) => {
	if (signal || (code && code !== 0)) {
		log.warning(`Received ${signal || `exit code ${code}`}, cleaning up...`)
		await cleanup()
	}
})

// Main execution
async function main() {
	console.log(`📁 Workspace: ${WORKSPACE_ROOT}\n`)

	await validateEnvironment()
	await buildHostArtifacts()
	await buildDockerImage()
	await runPlaywrightTests()

	console.log("\n🎉 All done!")
}

main().catch((error) => {
	log.error(`Failed: ${error.message}`)
	process.exit(1)
})

// --- Main workflow functions ---

async function validateEnvironment() {
	log.info("Validating environment...")

	if (!process.env.OPENROUTER_API_KEY) {
		log.error("OPENROUTER_API_KEY environment variable is not set")
		console.log('Please set it with: export OPENROUTER_API_KEY="your-api-key-here"')
		process.exit(1)
	}

	await runCommand("docker", ["--version"], { stdio: "pipe" })
	log.success("Environment validation passed")
}

async function buildHostArtifacts() {
	log.info("Building host artifacts...")

	process.chdir(WORKSPACE_ROOT)
	log.info(process.cwd())

	log.info("Installing dependencies...")
	await runCommand("pnpm", ["install", "--frozen-lockfile"], { cwd: WORKSPACE_ROOT })

	log.info("Building everything...")
	await runCommand("pnpm", ["-w", "run", "build"], { cwd: WORKSPACE_ROOT })

	log.success("Host artifacts built successfully")
}

async function buildDockerImage() {
	log.info("Building Docker image...")

	const buildArgs = [
		"buildx",
		"build",
		"-f",
		path.join(__dirname, "Dockerfile.playwright-ci"),
		"-t",
		IMAGE_NAME,
		"--load",
	]

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
	log.info("Running Playwright tests in Docker...")

	// Setup directories
	const testResultsDir = path.join(__dirname, "test-results")
	const reportDir = path.join(__dirname, "playwright-report")
	const dockerCacheDir = path.join(WORKSPACE_ROOT, ".docker-cache")

	await Promise.all([
		fs.ensureDir(testResultsDir).then(() => fs.emptyDir(testResultsDir)),
		fs.ensureDir(reportDir).then(() => fs.emptyDir(reportDir)),
		fs.ensureDir(dockerCacheDir),
	])

	// Generate unique container name
	const containerName = `playwright-ci-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
	currentContainer = containerName

	const dockerArgs = [
		"run",
		"--name",
		containerName,
		"--rm",
		"--cap-add=IPC_LOCK",
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
		"GNOME_KEYRING_CONTROL=1",
		IMAGE_NAME,
		...process.argv.slice(2).filter((arg) => !["--help", "-h"].includes(arg)),
	]

	await runCommand("docker", dockerArgs)
	currentContainer = null

	log.success("Playwright tests completed successfully!")
	console.log("\n📊 Test Results:")
	console.log(`  • Test results: ${testResultsDir}`)
	console.log(`  • HTML report: ${reportDir}`)
}

// --- Helper functions ---

// Enhanced command execution with automatic cleanup
async function runCommand(command, args, options = {}) {
	return execa(command, args, {
		stdio: options.stdio || "inherit",
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
		cleanup: true, // Automatic cleanup on parent exit
		...options,
	})
}

// Simple cleanup - kill the Docker container for faster shutdown
async function cleanup() {
	if (!currentContainer) return

	log.warning(`Stopping Docker container ${currentContainer}...`)
	const options = { stdio: "pipe", timeout: 5000, reject: false }

	try {
		// Use kill instead of stop for faster shutdown
		await execa("docker", ["kill", currentContainer], options)
	} catch {
		// Fallback to stop if kill fails
		await execa("docker", ["stop", "-t", "1", currentContainer], options)
	}

	currentContainer = null
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
