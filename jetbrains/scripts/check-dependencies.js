#!/usr/bin/env node

/**
 * JetBrains Plugin Dependency Check Script
 * Cross-platform Node.js version that works on Windows, macOS, and Linux
 */

const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

// Use available npm packages for cleaner code
const rimraf = require("rimraf")
const mkdirp = require("mkdirp")

// Constants
const REQUIRED_JAVA_VERSION = "17"
const RECOMMENDED_NODE_VERSION = "20"
const VSCODE_COMMIT = "174af221c9ea2ccdb64abe4aab8e1a805e77beae"
const VSCODE_REPO_URL = "https://github.com/microsoft/vscode.git"

// Paths
const scriptDir = __dirname
const projectRoot = path.resolve(scriptDir, "../..")
const jetbrainsDir = path.resolve(scriptDir, "..")
const vscodeDir = path.join(projectRoot, "deps", "vscode")
const depsDir = path.join(projectRoot, "deps")

// Track issues and fixes
let issuesFound = 0
let fixesApplied = 0

// Simple logging functions with inline colors
function printStatus(message) {
	console.log(`\x1b[34m[CHECK]\x1b[0m ${message}`)
}

function printSuccess(message) {
	console.log(`\x1b[32m[✓]\x1b[0m ${message}`)
}

function printWarning(message) {
	console.log(`\x1b[33m[⚠]\x1b[0m ${message}`)
}

function printError(message) {
	console.log(`\x1b[31m[✗]\x1b[0m ${message}`)
	issuesFound++
}

function printFix(message) {
	console.log(`\x1b[32m[FIX]\x1b[0m ${message}`)
	fixesApplied++
}

// Simple utility functions
function runCommand(command, options = {}) {
	try {
		return execSync(command, {
			encoding: "utf8",
			stdio: "pipe",
			...options,
		}).trim()
	} catch {
		return null
	}
}

function parseJavaVersion(versionOutput) {
	const newFormatMatch = versionOutput.match(/version "(\d+)\.(\d+)/)
	const oldFormatMatch = versionOutput.match(/version "1\.(\d+)/)
	return newFormatMatch?.[1] || oldFormatMatch?.[1] || null
}

function isCI() {
	return process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true" || process.env.JENKINS_URL
}

// Check functions
function checkJava() {
	printStatus("Checking Java installation...")

	if (process.env.DEVENV === "nix") {
		printSuccess("Nix environment detected, assuming Java is managed by Nix")
		return true
	}

	const javaCommand = process.platform === "win32" ? "where java" : "which java"
	if (!runCommand(javaCommand)) {
		printError("Java is not installed or not in PATH")
		console.log("  Install Java 17 (recommended):")
		console.log("  - Windows: Download from https://openjdk.org/projects/jdk/17/")
		console.log("  - macOS: brew install openjdk@17")
		console.log("  - Linux: sudo apt install openjdk-17-jdk")
		return false
	}

	const javaVersionOutput = runCommand("java -version 2>&1")
	if (!javaVersionOutput) {
		printError("Could not determine Java version")
		return false
	}

	const majorVersion = parseJavaVersion(javaVersionOutput)
	const currentVersion = javaVersionOutput.split("\n")[0]

	if (majorVersion !== REQUIRED_JAVA_VERSION) {
		const isWindows = process.platform === "win32"

		if (isCI() && isWindows) {
			printWarning(`Java version is ${majorVersion}, but Java ${REQUIRED_JAVA_VERSION} is required for JetBrains plugin development`)
			console.log(`  Current Java: ${currentVersion}`)
			console.log("  Windows CI Environment detected - JetBrains plugin build will be skipped")
			return true
		} else if (isCI()) {
			printWarning(`Java version is ${majorVersion}, but Java ${REQUIRED_JAVA_VERSION} is recommended for JetBrains plugin development`)
			console.log(`  Current Java: ${currentVersion}`)
			console.log("  CI Environment detected - continuing with available Java version")
			return true
		} else {
			printError(`Java version is ${majorVersion}, but Java ${REQUIRED_JAVA_VERSION} is required`)
			console.log(`  Current Java: ${currentVersion}`)
			console.log("  Recommended fix:")
			console.log(`  - Windows: Download Java ${REQUIRED_JAVA_VERSION} from https://openjdk.org/projects/jdk/${REQUIRED_JAVA_VERSION}/`)
			console.log(`  - macOS: brew install openjdk@${REQUIRED_JAVA_VERSION}`)
			console.log(`  - Linux: sudo apt install openjdk-${REQUIRED_JAVA_VERSION}-jdk`)
			return false
		}
	}

	printSuccess(`Java ${REQUIRED_JAVA_VERSION} is installed and active`)
	console.log(`  ${currentVersion}`)
	return true
}

function checkNode() {
	printStatus("Checking Node.js installation...")

	const nodeCommand = process.platform === "win32" ? "where node" : "which node"
	if (!runCommand(nodeCommand)) {
		printError("Node.js is not installed")
		console.log(`  Install Node.js ${RECOMMENDED_NODE_VERSION}.x:`)
		console.log(`  - Use nvm: nvm install ${RECOMMENDED_NODE_VERSION} && nvm use ${RECOMMENDED_NODE_VERSION}`)
		console.log("  - Or download from: https://nodejs.org/")
		return false
	}

	const nodeVersion = runCommand("node -v")
	if (!nodeVersion) {
		printError("Could not determine Node.js version")
		return false
	}

	const majorVersion = nodeVersion.replace("v", "").split(".")[0]
	if (majorVersion !== RECOMMENDED_NODE_VERSION) {
		printWarning(`Node.js version is ${majorVersion}, recommended version is ${RECOMMENDED_NODE_VERSION}.x`)
		console.log(`  Current Node.js: ${nodeVersion}`)
	} else {
		printSuccess(`Node.js ${RECOMMENDED_NODE_VERSION}.x is installed`)
		console.log(`  Version: ${nodeVersion}`)
	}
	return true
}

function checkPnpm() {
	printStatus("Checking pnpm installation...")

	const pnpmCommand = process.platform === "win32" ? "where pnpm" : "which pnpm"
	if (!runCommand(pnpmCommand)) {
		printError("pnpm is not installed")
		console.log("  Install pnpm: npm install -g pnpm")
		return false
	}

	const pnpmVersion = runCommand("pnpm -v")
	printSuccess("pnpm is installed")
	console.log(`  Version: ${pnpmVersion}`)
	return true
}

function checkGradle() {
	printStatus("Checking Gradle wrapper...")

	const gradleWrapper = path.join(jetbrainsDir, "plugin", process.platform === "win32" ? "gradlew.bat" : "gradlew")

	if (!fs.existsSync(gradleWrapper)) {
		printError(`Gradle wrapper not found: ${gradleWrapper}`)
		return false
	}

	// On Unix systems, ensure executable permissions
	if (process.platform !== "win32") {
		try {
			const stats = fs.statSync(gradleWrapper)
			if (!(stats.mode & parseInt("111", 8))) {
				printWarning("Gradle wrapper is not executable, fixing...")
				fs.chmodSync(gradleWrapper, "755")
				printFix("Made Gradle wrapper executable")
			}
		} catch (error) {
			printWarning("Could not check Gradle wrapper permissions")
		}
	}

	printSuccess("Gradle wrapper is available")
	return true
}

function setupVscodeRepository() {
	printWarning("Setting up VSCode repository...")

	// Clean removal and setup using npm packages
	rimraf.sync(vscodeDir)
	mkdirp.sync(depsDir)

	// Clone repository
	const originalDir = process.cwd()
	try {
		process.chdir(depsDir)
		const cloneResult = runCommand(`git clone ${VSCODE_REPO_URL} vscode`)
		if (!cloneResult) {
			printError("Failed to clone VSCode repository")
			return false
		}
		printFix("VSCode repository cloned successfully")

		// Checkout specific commit
		process.chdir(vscodeDir)
		const checkoutResult = runCommand(`git checkout ${VSCODE_COMMIT}`)
		if (!checkoutResult) {
			printWarning("Could not checkout specific commit, using current HEAD")
		} else {
			printSuccess("Checked out specific VSCode commit")
		}

		return true
	} finally {
		process.chdir(originalDir)
	}
}

function checkVscodeDirectory() {
	printStatus("Checking VSCode directory...")

	const expectedFile = path.join(vscodeDir, "src", "vs", "code", "electron-main", "main.ts")
	const patchFile = path.join(projectRoot, "deps", "patches", "vscode", "jetbrains.patch")
	const gitDisabledFile = path.join(vscodeDir, ".git.disabled")

	// Check if VSCode directory is already fully set up
	if (fs.existsSync(expectedFile) && fs.existsSync(gitDisabledFile)) {
		printSuccess("VSCode directory is already properly configured")
		return true
	}

	// Setup repository if expected file doesn't exist
	if (!fs.existsSync(expectedFile)) {
		if (!setupVscodeRepository()) {
			return false
		}
	}

	// Only attempt git operations if .git directory exists (not .git.disabled)
	const gitFile = path.join(vscodeDir, ".git")
	if (fs.existsSync(gitFile)) {
		// Apply patch (handle case where patch might already be applied)
		printStatus("Applying JetBrains patch...")
		const originalDir = process.cwd()
		try {
			process.chdir(vscodeDir)
			const relativePatchPath = path.relative(vscodeDir, patchFile)

			// Try applying the patch, but don't fail if it's already applied
			const patchResult = runCommand(`git apply ${relativePatchPath}`)
			if (patchResult === null) {
				// Check if we have modified files (patch might be already applied)
				const statusResult = runCommand("git status --porcelain")
				if (statusResult && statusResult.length > 0) {
					printSuccess("JetBrains patch already applied")
				} else {
					printWarning("Patch may already be applied or failed - continuing anyway")
				}
			} else {
				printSuccess("JetBrains patch applied successfully")
			}

			// Disable git tracking
			if (!fs.existsSync(gitDisabledFile)) {
				fs.renameSync(gitFile, gitDisabledFile)
				printFix("Disabled git tracking for VSCode directory")
			}
		} finally {
			process.chdir(originalDir)
		}
	} else if (fs.existsSync(gitDisabledFile)) {
		printSuccess("Git tracking already disabled for VSCode directory")
	}

	printSuccess("VSCode directory is ready")
	return true
}

function checkProjectDependencies() {
	printStatus("Checking project dependencies...")

	const originalDir = process.cwd()
	try {
		process.chdir(projectRoot)

		if (!fs.existsSync("node_modules") || !fs.existsSync("pnpm-lock.yaml")) {
			printWarning("Project dependencies not installed")
			console.log("  Installing dependencies with pnpm...")

			const result = runCommand("pnpm install")
			if (!result) {
				printError("Failed to install project dependencies")
				return false
			}
			printFix("Project dependencies installed successfully")
		} else {
			printSuccess("Project dependencies are installed")
		}
		return true
	} finally {
		process.chdir(originalDir)
	}
}

function checkJetbrainsHostDeps() {
	printStatus("Checking JetBrains host dependencies...")

	const hostDir = path.join(jetbrainsDir, "host")
	const packageJson = path.join(hostDir, "package.json")
	const tsconfig = path.join(hostDir, "tsconfig.json")

	if (fs.existsSync(packageJson) && fs.existsSync(tsconfig)) {
		printSuccess("JetBrains host is configured")
		return true
	} else {
		printError("JetBrains host configuration files are missing")
		console.log("  Missing files: package.json or tsconfig.json")
		return false
	}
}

function checkBuildSystem() {
	printStatus("Checking build system...")

	const pluginDir = path.join(jetbrainsDir, "plugin")
	const gradlew = path.join(pluginDir, process.platform === "win32" ? "gradlew.bat" : "gradlew")
	const buildGradle = path.join(pluginDir, "build.gradle.kts")
	const gradleProps = path.join(pluginDir, "gradle.properties")

	if (fs.existsSync(gradlew) && fs.existsSync(buildGradle) && fs.existsSync(gradleProps)) {
		printSuccess("Gradle build system is configured")
		return true
	} else {
		printError("Gradle build system files are missing")
		console.log("  Missing files: gradlew, build.gradle.kts, or gradle.properties")
		return false
	}
}

function runChecks() {
	console.log("Starting dependency checks...")
	console.log("")

	// Dependency checks in logical order
	const checks = [
		{ name: "Java", fn: checkJava },
		{ name: "Node.js", fn: checkNode },
		{ name: "pnpm", fn: checkPnpm },
		{ name: "Gradle", fn: checkGradle },
		{ name: "VSCode Directory", fn: checkVscodeDirectory },
		{ name: "Project Dependencies", fn: checkProjectDependencies },
		{ name: "JetBrains Host", fn: checkJetbrainsHostDeps },
		{ name: "Build System", fn: checkBuildSystem },
	]

	let allPassed = true
	for (const check of checks) {
		try {
			const result = check.fn()
			if (!result) {
				allPassed = false
			}
		} catch (error) {
			printError(`${check.name} check failed: ${error.message}`)
			allPassed = false
		}
	}

	return allPassed
}

function main() {
	console.log(`\x1b[34m🔍 JetBrains Plugin Dependency Check\x1b[0m`)
	console.log(`Project root: ${projectRoot}`)
	console.log(`JetBrains dir: ${jetbrainsDir}`)
	console.log("")

	const success = runChecks()

	console.log("")
	console.log("==================================")

	if (success) {
		printSuccess("All dependencies are properly configured!")
		console.log("")
		console.log("You can now build the JetBrains plugin:")
		console.log("  Development: pnpm jetbrains:run")
		console.log("  Production:  cd jetbrains/plugin && ./gradlew buildPlugin -PdebugMode=release")
	} else {
		printError(`Found ${issuesFound} issue(s) that need to be resolved`)
		if (fixesApplied > 0) {
			console.log(`\x1b[32mApplied ${fixesApplied} automatic fix(es)\x1b[0m`)
		}
		console.log("")
		console.log("Please resolve the issues above and run this script again.")
	}

	console.log("")
	console.log("For more information, see jetbrains/README.md")

	if (!success) {
		process.exit(1)
	}
}

main()
