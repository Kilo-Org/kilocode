#!/usr/bin/env node

/**
 * JetBrains Plugin Dependency Check Script
 * Cross-platform Node.js version that works on Windows, macOS, and Linux
 */

const fs = require("fs")
const path = require("path")
const { execSync, spawn } = require("child_process")

// Colors for output (Windows compatible)
const colors = {
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	reset: "\x1b[0m",
}

// Paths
const scriptDir = __dirname
const projectRoot = path.resolve(scriptDir, "../..")
const jetbrainsDir = path.resolve(scriptDir, "..")

console.log(`${colors.blue}🔍 JetBrains Plugin Dependency Check${colors.reset}`)
console.log(`Project root: ${projectRoot}`)
console.log(`JetBrains dir: ${jetbrainsDir}`)
console.log("")

// Track issues
let issuesFound = 0
let fixesApplied = 0

// Helper functions
function printStatus(message) {
	console.log(`${colors.blue}[CHECK]${colors.reset} ${message}`)
}

function printSuccess(message) {
	console.log(`${colors.green}[✓]${colors.reset} ${message}`)
}

function printWarning(message) {
	console.log(`${colors.yellow}[⚠]${colors.reset} ${message}`)
}

function printError(message) {
	console.log(`${colors.red}[✗]${colors.reset} ${message}`)
	issuesFound++
}

function printFix(message) {
	console.log(`${colors.green}[FIX]${colors.reset} ${message}`)
	fixesApplied++
}

function commandExists(command) {
	try {
		execSync(`${process.platform === "win32" ? "where" : "which"} ${command}`, {
			stdio: "ignore",
		})
		return true
	} catch {
		return false
	}
}

function runCommand(command, options = {}) {
	try {
		return execSync(command, {
			encoding: "utf8",
			stdio: "pipe",
			...options,
		}).trim()
	} catch (error) {
		return null
	}
}

// Check functions
function checkJava() {
	printStatus("Checking Java installation...")

	if (process.env.DEVENV === "nix") {
		printSuccess("Nix environment detected, assuming Java is managed by Nix")
		return true
	}

	if (!commandExists("java")) {
		printError("Java is not installed or not in PATH")
		console.log("  Install Java 21 (recommended):")
		console.log("  - Windows: Download from https://openjdk.org/projects/jdk/21/")
		console.log("  - macOS: brew install openjdk@21")
		console.log("  - Linux: sudo apt install openjdk-21-jdk")
		return false
	}

	const javaVersion = runCommand("java -version 2>&1")
	if (!javaVersion) {
		printError("Could not determine Java version")
		return false
	}

	// Parse Java version - handle both old format (1.8.0_xxx) and new format (17.0.x)
	let majorVersion = null
	const newFormatMatch = javaVersion.match(/version "(\d+)\.(\d+)/)
	const oldFormatMatch = javaVersion.match(/version "1\.(\d+)/)

	if (newFormatMatch) {
		majorVersion = newFormatMatch[1]
	} else if (oldFormatMatch) {
		majorVersion = oldFormatMatch[1]
	}

	// Check if we're in CI environment
	const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true" || process.env.JENKINS_URL
	const isWindows = process.platform === "win32"

	if (majorVersion !== "21") {
		if (isCI && isWindows) {
			printWarning(`Java version is ${majorVersion}, but Java 21 is required for JetBrains plugin development`)
			console.log(`  Current Java: ${javaVersion.split("\n")[0]}`)
			console.log("  Windows CI Environment detected - JetBrains plugin build will be skipped")
			console.log("  Note: JetBrains plugin requires Java 21, which is not available in this environment")
			console.log("  This is expected behavior - JetBrains plugin builds are primarily tested on Linux/macOS CI")
			return true // Allow CI to continue, but JetBrains build will be skipped
		} else if (isCI) {
			printWarning(`Java version is ${majorVersion}, but Java 21 is recommended for JetBrains plugin development`)
			console.log(`  Current Java: ${javaVersion.split("\n")[0]}`)
			console.log("  CI Environment detected - continuing with available Java version")
			console.log(`  Note: Some features may not work correctly with Java ${majorVersion}`)
			return true // Allow CI to continue with warning
		} else {
			printError(`Java version is ${majorVersion}, but Java 21 is required`)
			console.log(`  Current Java: ${javaVersion.split("\n")[0]}`)
			console.log("  Recommended fix:")
			console.log("  - Windows: Download Java 21 from https://openjdk.org/projects/jdk/21/")
			console.log("  - macOS: brew install openjdk@21 && export JAVA_HOME=$(/usr/libexec/java_home -v 21)")
			console.log(
				"  - Linux: sudo apt install openjdk-21-jdk && export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64",
			)
			return false
		}
	}

	printSuccess("Java 21 is installed and active")
	console.log(`  ${javaVersion.split("\n")[0]}`)
	return true
}

function checkNode() {
	printStatus("Checking Node.js installation...")

	if (!commandExists("node")) {
		printError("Node.js is not installed")
		console.log("  Install Node.js 20.x:")
		console.log("  - Use nvm: nvm install 20 && nvm use 20")
		console.log("  - Or download from: https://nodejs.org/")
		return false
	}

	const nodeVersion = runCommand("node -v")
	if (!nodeVersion) {
		printError("Could not determine Node.js version")
		return false
	}

	const majorVersion = nodeVersion.replace("v", "").split(".")[0]
	if (majorVersion !== "20") {
		printWarning(`Node.js version is ${majorVersion}, recommended version is 20.x`)
		console.log(`  Current Node.js: ${nodeVersion}`)
	} else {
		printSuccess("Node.js 20.x is installed")
		console.log(`  Version: ${nodeVersion}`)
	}
	return true
}

function checkPnpm() {
	printStatus("Checking pnpm installation...")

	if (!commandExists("pnpm")) {
		printError("pnpm is not installed")
		console.log("  Install pnpm: npm install -g pnpm")
		return false
	}

	const pnpmVersion = runCommand("pnpm -v")
	printSuccess("pnpm is installed")
	console.log(`  Version: ${pnpmVersion}`)
	return true
}

function checkVscodeSubmodule() {
	printStatus("Checking VSCode submodule...")

	const vscodeDir = path.join(projectRoot, "deps", "vscode")

	if (!fs.existsSync(vscodeDir)) {
		printError(`VSCode submodule directory not found: ${vscodeDir}`)
		return false
	}

	const srcDir = path.join(vscodeDir, "src")
	if (!fs.existsSync(srcDir) || fs.readdirSync(srcDir).length === 0) {
		printWarning("VSCode submodule is not initialized")
		console.log("  Initializing VSCode submodule...")

		process.chdir(projectRoot)
		const result = runCommand("git submodule update --init --recursive")
		if (result !== null) {
			printFix("VSCode submodule initialized successfully")
		} else {
			printError("Failed to initialize VSCode submodule")
			return false
		}
	} else {
		printSuccess("VSCode submodule is initialized")
	}

	// Check if submodule has expected content
	const expectedFile = path.join(vscodeDir, "src", "vs", "code", "electron-main", "main.ts")
	if (fs.existsSync(expectedFile)) {
		printSuccess("VSCode submodule contains expected files")
	} else {
		printError("VSCode submodule appears to be incomplete")
		console.log(`  Expected file: ${expectedFile}`)
		console.log("  Try: git submodule update --init --recursive --force")
		return false
	}

	return true
}

function checkGradle() {
	printStatus("Checking Gradle wrapper...")

	const gradleWrapper = path.join(jetbrainsDir, "plugin", process.platform === "win32" ? "gradlew.bat" : "gradlew")

	if (!fs.existsSync(gradleWrapper)) {
		printError(`Gradle wrapper not found: ${gradleWrapper}`)
		return false
	}

	// On Unix systems, check if executable
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

function checkProjectDependencies() {
	printStatus("Checking project dependencies...")

	process.chdir(projectRoot)

	if (!fs.existsSync("node_modules") || !fs.existsSync("pnpm-lock.yaml")) {
		printWarning("Project dependencies not installed")
		console.log("  Installing dependencies with pnpm...")

		const result = runCommand("pnpm install")
		if (result !== null) {
			printFix("Project dependencies installed successfully")
		} else {
			printError("Failed to install project dependencies")
			return false
		}
	} else {
		printSuccess("Project dependencies are installed")
	}

	return true
}

function checkJetbrainsHostDeps() {
	printStatus("Checking JetBrains host dependencies...")

	const hostDir = path.join(jetbrainsDir, "host")
	const packageJson = path.join(hostDir, "package.json")
	const tsconfig = path.join(hostDir, "tsconfig.json")

	if (fs.existsSync(packageJson) && fs.existsSync(tsconfig)) {
		printSuccess("JetBrains host is configured")
	} else {
		printError("JetBrains host configuration files are missing")
		console.log("  Missing files: package.json or tsconfig.json")
		return false
	}

	return true
}

function checkBuildSystem() {
	printStatus("Checking build system...")

	const pluginDir = path.join(jetbrainsDir, "plugin")
	const gradlew = path.join(pluginDir, process.platform === "win32" ? "gradlew.bat" : "gradlew")
	const buildGradle = path.join(pluginDir, "build.gradle.kts")
	const gradleProps = path.join(pluginDir, "gradle.properties")

	if (fs.existsSync(gradlew) && fs.existsSync(buildGradle) && fs.existsSync(gradleProps)) {
		printSuccess("Gradle build system is configured")
	} else {
		printError("Gradle build system files are missing")
		console.log("  Missing files: gradlew, build.gradle.kts, or gradle.properties")
		return false
	}

	return true
}

// Main execution
function main() {
	console.log("Starting dependency checks...")
	console.log("")

	// Run all checks with error handling
	const checks = [
		checkJava,
		checkNode,
		checkPnpm,
		checkVscodeSubmodule,
		checkGradle,
		checkProjectDependencies,
		checkJetbrainsHostDeps,
		checkBuildSystem,
	]

	checks.forEach((check) => {
		try {
			check()
		} catch (error) {
			console.log(`Warning: ${check.name} had issues: ${error.message}`)
		}
	})

	console.log("")
	console.log("==================================")

	if (issuesFound === 0) {
		printSuccess("All dependencies are properly configured!")
		console.log("")
		console.log("You can now build the JetBrains plugin:")
		console.log("  Development: pnpm jetbrains:run")
		console.log("  Production:  cd jetbrains/plugin && ./gradlew buildPlugin -PdebugMode=release")
	} else {
		printError(`Found ${issuesFound} issue(s) that need to be resolved`)
		if (fixesApplied > 0) {
			console.log(`${colors.green}Applied ${fixesApplied} automatic fix(es)${colors.reset}`)
		}
		console.log("")
		console.log("Please resolve the issues above and run this script again.")
		process.exit(1)
	}

	console.log("")
	console.log("For more information, see jetbrains/README.md")
}

// Run main function
main()
