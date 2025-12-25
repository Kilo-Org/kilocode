#!/usr/bin/env tsx

/**
 * Test runner for Context Engine
 * Usage: tsx src/context-engine/__tests__/run-tests.ts
 */

import { runComprehensiveTests } from "./comprehensive.test"

async function main() {
	console.log("Starting Context Engine test suite...")
	console.log("Node version:", process.version)
	console.log("Platform:", process.platform)
	console.log()

	try {
		await runComprehensiveTests()
		process.exit(0)
	} catch (error) {
		console.error("Fatal error:", error)
		process.exit(1)
	}
}

main()
