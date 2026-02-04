/**
 * Serve script for Roo Code extension development
 *
 * Usage:
 *   pnpm code-server:install    # Build and install the extension into code-server
 *
 * After making code changes, run `pnpm code-server:install` again and reload the window
 * (Cmd+Shift+P → "Developer: Reload Window")
 */

const { execSync } = require("child_process")
const path = require("path")
const os = require("os")

const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const CYAN = "\x1b[36m"
const RED = "\x1b[31m"

// Build vsix to a fixed path in temp directory
const VSIX_PATH = path.join(os.tmpdir(), "roo-code-serve.vsix")

function log(message) {
	console.log(`${CYAN}[code-server]${RESET} ${message}`)
}

function logSuccess(message) {
	console.log(`${GREEN}✓${RESET} ${message}`)
}

function logWarning(message) {
	console.log(`${YELLOW}⚠${RESET} ${message}`)
}

function logError(message) {
	console.error(`${RED}✗${RESET} ${message}`)
}

async function main() {
	console.log(`\n${BOLD}🔧 Roo Code - Install Extension${RESET}\n`)

	// Build vsix to temp directory
	log(`Building vsix to ${VSIX_PATH}...`)
	try {
		execSync(`pnpm vsix -- --out "${VSIX_PATH}"`, { stdio: "inherit" })
		logSuccess("Build complete")
	} catch (error) {
		logError("Build failed")
		process.exit(1)
	}

	// Install extension into code-server
	log("Installing extension into code-server...")
	try {
		execSync(`code-server --install-extension "${VSIX_PATH}"`, { stdio: "inherit" })
		logSuccess("Extension installed")
	} catch (error) {
		logWarning("Extension installation had warnings (this is usually fine)")
	}

	console.log(`\n${GREEN}✓ Extension built and installed.${RESET}`)
	console.log(`  If code-server is running, reload the window to pick up changes.`)
	console.log(`  (Cmd+Shift+P → "Developer: Reload Window")\n`)
}

main().catch((error) => {
	logError(error.message)
	process.exit(1)
})
