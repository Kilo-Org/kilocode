/**
 * Basic integration test for Context Engine
 * This is a minimal test to verify the system works
 */

import { getContextEngine } from "../index"
import type { ContextEngine } from "../index"

/**
 * Test basic engine initialization
 */
async function testInitialization(): Promise<boolean> {
	try {
		console.log("Testing Context Engine initialization...")

		const engine = getContextEngine()

		// Initialize
		await engine.initialize()
		console.log("✅ Engine initialized successfully")

		// Get stats
		const stats = engine.getIndexingStats()
		console.log("✅ Got indexing stats:", stats)

		// Shutdown
		await engine.shutdown()
		console.log("✅ Engine shutdown successfully")

		return true
	} catch (error) {
		console.error("❌ Initialization test failed:", error)
		return false
	}
}

/**
 * Test memory management
 */
async function testMemory(): Promise<boolean> {
	try {
		console.log("\nTesting Memory System...")

		const engine = getContextEngine()
		await engine.initialize()

		// Access memory manager through engine
		// Note: This requires exposing memoryManager in the engine
		// For now, just test that we can get performance metrics
		const metrics = await engine.getPerformanceMetrics()
		console.log("✅ Got performance metrics:", {
			queryLatencyP50: metrics.queryLatencyP50,
			cacheHitRate: metrics.cacheHitRate,
			memoryFootprint: metrics.memoryFootprint,
		})

		await engine.shutdown()
		return true
	} catch (error) {
		console.error("❌ Memory test failed:", error)
		return false
	}
}

/**
 * Test search functionality (basic)
 */
async function testSearch(): Promise<boolean> {
	try {
		console.log("\nTesting Search System...")

		const engine = getContextEngine()
		await engine.initialize()

		// Try a basic search (will return empty until indexed)
		const results = await engine.search({
			query: "test query",
			limit: 5,
		})

		console.log(`✅ Search completed, found ${results.length} results`)

		await engine.shutdown()
		return true
	} catch (error) {
		console.error("❌ Search test failed:", error)
		return false
	}
}

/**
 * Run all tests
 */
async function runTests(): Promise<void> {
	console.log("=== Context Engine Integration Tests ===\n")

	const tests = [
		{ name: "Initialization", fn: testInitialization },
		{ name: "Memory System", fn: testMemory },
		{ name: "Search System", fn: testSearch },
	]

	let passed = 0
	let failed = 0

	for (const test of tests) {
		const result = await test.fn()
		if (result) {
			passed++
		} else {
			failed++
		}
	}

	console.log("\n=== Test Results ===")
	console.log(`✅ Passed: ${passed}`)
	console.log(`❌ Failed: ${failed}`)
	console.log(`📊 Total: ${tests.length}`)

	if (failed === 0) {
		console.log("\n🎉 All tests passed!")
	} else {
		console.log(`\n⚠️  ${failed} test(s) failed`)
	}
}

// Export for external use
export { runTests, testInitialization, testMemory, testSearch }

// Run tests if executed directly
if (require.main === module) {
	runTests().catch(console.error)
}
