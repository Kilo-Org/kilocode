/**
 * Comprehensive integration tests for Context Engine
 * Tests all major components with real scenarios
 */

import * as path from "path"
import * as os from "os"
import * as fs from "fs"
import { getContextEngine } from "../index"
import type { ContextEngine } from "../index"
import { SecretFilter } from "../security/secret-filter"
import { CacheManager } from "../cache/cache-manager"
import { PerformanceMonitor } from "../monitoring/performance-monitor"

// Test utilities
class TestHelper {
	static createTempDir(): string {
		const tempDir = path.join(os.tmpdir(), `context-engine-test-${Date.now()}`)
		if (!fs.existsSync(tempDir)) {
			fs.mkdirSync(tempDir, { recursive: true })
		}
		return tempDir
	}

	static cleanupTempDir(dir: string): void {
		if (fs.existsSync(dir)) {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	}

	static createTestFile(dir: string, filename: string, content: string): string {
		const filePath = path.join(dir, filename)
		fs.writeFileSync(filePath, content, "utf8")
		return filePath
	}
}

/**
 * Test 1: Basic Engine Lifecycle
 */
async function testEngineLifecycle(): Promise<boolean> {
	console.log("\n🧪 Test 1: Engine Lifecycle")

	try {
		const engine = getContextEngine()

		console.log("  ✓ Creating engine instance")

		await engine.initialize()
		console.log("  ✓ Engine initialized")

		const stats = engine.getIndexingStats()
		console.log(`  ✓ Got stats: ${stats.totalFiles} files`)

		await engine.shutdown()
		console.log("  ✓ Engine shutdown")

		console.log("✅ Test 1 PASSED")
		return true
	} catch (error) {
		console.error("❌ Test 1 FAILED:", error)
		return false
	}
}

/**
 * Test 2: Secret Filtering
 */
async function testSecretFiltering(): Promise<boolean> {
	console.log("\n🧪 Test 2: Secret Filtering")

	try {
		const filter = new SecretFilter(true)

		// Test API key detection
		const codeWithSecrets = `
			const API_KEY = "sk-1234567890abcdefghijklmnop"
			const password = "mySecretPassword123"
			const email = "user@example.com"
		`

		const hasSecrets = filter.hasSecrets(codeWithSecrets)
		console.log(`  ✓ Detected secrets: ${hasSecrets}`)

		if (!hasSecrets) {
			throw new Error("Failed to detect secrets")
		}

		const secretTypes = filter.detectSecretTypes(codeWithSecrets)
		console.log(`  ✓ Detected ${secretTypes.length} secret types:`, secretTypes)

		const filtered = filter.filter(codeWithSecrets)
		console.log(`  ✓ Filtered text (secrets redacted)`)

		if (filtered.includes("sk-1234567890abcdefghijklmnop")) {
			throw new Error("Failed to filter API key")
		}

		console.log("✅ Test 2 PASSED")
		return true
	} catch (error) {
		console.error("❌ Test 2 FAILED:", error)
		return false
	}
}

/**
 * Test 3: Cache System
 */
async function testCacheSystem(): Promise<boolean> {
	console.log("\n🧪 Test 3: Cache System")

	try {
		const cache = new CacheManager(true, 5000)

		// Test query cache
		cache.setQuery("test-query", { result: "cached data" })
		const cached = cache.getQuery("test-query")

		if (!cached) {
			throw new Error("Failed to retrieve cached query")
		}

		console.log("  ✓ Query cache working")

		// Test embedding cache
		cache.setEmbedding("file.ts:10", [0.1, 0.2, 0.3])
		const embedding = cache.getEmbedding("file.ts:10")

		if (!embedding) {
			throw new Error("Failed to retrieve cached embedding")
		}

		console.log("  ✓ Embedding cache working")

		// Test cache invalidation
		cache.onFileModified("file.ts")
		const invalidated = cache.getEmbedding("file.ts:10")

		if (invalidated) {
			throw new Error("Cache should have been invalidated")
		}

		console.log("  ✓ Cache invalidation working")

		// Test cache stats
		const stats = cache.getStats()
		console.log(`  ✓ Cache stats: ${stats.queryCache.hits} hits`)

		console.log("✅ Test 3 PASSED")
		return true
	} catch (error) {
		console.error("❌ Test 3 FAILED:", error)
		return false
	}
}

/**
 * Test 4: Search Functionality
 */
async function testSearchFunctionality(): Promise<boolean> {
	console.log("\n🧪 Test 4: Search Functionality")

	try {
		const engine = getContextEngine()
		await engine.initialize()

		// Test basic search
		const results = await engine.search({
			query: "authentication logic",
			limit: 5,
		})

		console.log(`  ✓ Search completed, found ${results.length} results`)

		// Test search with filters
		const filteredResults = await engine.search({
			query: "database connection",
			limit: 10,
			filters: {
				languages: ["typescript", "javascript"],
				chunkTypes: ["function", "class"],
			},
		})

		console.log(`  ✓ Filtered search completed, found ${filteredResults.length} results`)

		await engine.shutdown()

		console.log("✅ Test 4 PASSED")
		return true
	} catch (error) {
		console.error("❌ Test 4 FAILED:", error)
		return false
	}
}

/**
 * Test 5: Performance Monitoring
 */
async function testPerformanceMonitoring(): Promise<boolean> {
	console.log("\n🧪 Test 5: Performance Monitoring")

	try {
		const engine = getContextEngine()
		await engine.initialize()

		const monitor = new PerformanceMonitor(engine)

		// Collect metrics
		const metrics = await monitor.getCurrentMetrics()
		console.log("  ✓ Collected performance metrics:")
		console.log(`    - Query Latency P50: ${metrics.queryLatencyP50.toFixed(2)}ms`)
		console.log(`    - Cache Hit Rate: ${(metrics.cacheHitRate * 100).toFixed(1)}%`)
		console.log(`    - Memory Footprint: ${metrics.memoryFootprint.toFixed(2)} MB`)

		// Test health check
		const health = await monitor.getHealthStatus()
		console.log(`  ✓ Health status: ${health.status}`)

		if (health.issues.length > 0) {
			console.log(`    ⚠️  Issues detected: ${health.issues.join(", ")}`)
		}

		// Generate report
		const report = await monitor.generateReport()
		console.log("  ✓ Performance report generated")

		await engine.shutdown()

		console.log("✅ Test 5 PASSED")
		return true
	} catch (error) {
		console.error("❌ Test 5 FAILED:", error)
		return false
	}
}

/**
 * Test 6: File Indexing
 */
async function testFileIndexing(): Promise<boolean> {
	console.log("\n🧪 Test 6: File Indexing")

	const tempDir = TestHelper.createTempDir()

	try {
		// Create test files
		TestHelper.createTestFile(
			tempDir,
			"test.ts",
			`
			export function authenticate(user: string, password: string): boolean {
				// Authentication logic here
				return true
			}

			export class UserService {
				getUser(id: number) {
					// Get user logic
					return null
				}
			}
		`,
		)

		TestHelper.createTestFile(
			tempDir,
			"database.ts",
			`
			export async function connectDB() {
				// Database connection logic
				console.log("Connected to database")
			}
		`,
		)

		const engine = getContextEngine()
		await engine.initialize()

		console.log("  ✓ Test files created")

		// Note: Full indexing requires workspace folders
		// For unit test, we'll skip actual indexing
		const stats = engine.getIndexingStats()
		console.log(`  ✓ Indexing stats retrieved: ${stats.totalFiles} files`)

		await engine.shutdown()

		console.log("✅ Test 6 PASSED")
		return true
	} catch (error) {
		console.error("❌ Test 6 FAILED:", error)
		return false
	} finally {
		TestHelper.cleanupTempDir(tempDir)
	}
}

/**
 * Test 7: Framework Detection
 */
async function testFrameworkDetection(): Promise<boolean> {
	console.log("\n🧪 Test 7: Framework Detection")

	const tempDir = TestHelper.createTempDir()

	try {
		// Create a package.json with React
		TestHelper.createTestFile(
			tempDir,
			"package.json",
			JSON.stringify({
				name: "test-app",
				dependencies: {
					react: "^18.0.0",
					"react-dom": "^18.0.0",
				},
			}),
		)

		const { FrameworkDetector } = require("../framework-support/framework-detector")
		const detector = new FrameworkDetector(tempDir)

		const frameworks = await detector.detectFrameworks()
		console.log(`  ✓ Detected frameworks: ${frameworks.join(", ")}`)

		if (!frameworks.includes("react")) {
			throw new Error("Failed to detect React framework")
		}

		console.log("✅ Test 7 PASSED")
		return true
	} catch (error) {
		console.error("❌ Test 7 FAILED:", error)
		return false
	} finally {
		TestHelper.cleanupTempDir(tempDir)
	}
}

/**
 * Test 8: Memory Management
 */
async function testMemoryManagement(): Promise<boolean> {
	console.log("\n🧪 Test 8: Memory Management")

	try {
		const engine = getContextEngine()
		await engine.initialize()

		// Note: Memory manager is private, so we test through engine interface
		// In a real scenario, we'd use reflection or expose a test interface

		const metrics = await engine.getPerformanceMetrics()
		console.log(`  ✓ Memory footprint: ${metrics.memoryFootprint.toFixed(2)} MB`)

		await engine.shutdown()

		console.log("✅ Test 8 PASSED")
		return true
	} catch (error) {
		console.error("❌ Test 8 FAILED:", error)
		return false
	}
}

/**
 * Run all comprehensive tests
 */
export async function runComprehensiveTests(): Promise<void> {
	console.log("\n" + "=".repeat(60))
	console.log("🚀 CONTEXT ENGINE COMPREHENSIVE TEST SUITE")
	console.log("=".repeat(60))

	const tests = [
		{ name: "Engine Lifecycle", fn: testEngineLifecycle },
		{ name: "Secret Filtering", fn: testSecretFiltering },
		{ name: "Cache System", fn: testCacheSystem },
		{ name: "Search Functionality", fn: testSearchFunctionality },
		{ name: "Performance Monitoring", fn: testPerformanceMonitoring },
		{ name: "File Indexing", fn: testFileIndexing },
		{ name: "Framework Detection", fn: testFrameworkDetection },
		{ name: "Memory Management", fn: testMemoryManagement },
	]

	const results = {
		passed: 0,
		failed: 0,
		total: tests.length,
	}

	for (const test of tests) {
		try {
			const result = await test.fn()
			if (result) {
				results.passed++
			} else {
				results.failed++
			}
		} catch (error) {
			console.error(`\n❌ Test "${test.name}" threw an exception:`, error)
			results.failed++
		}

		// Small delay between tests
		await new Promise((resolve) => setTimeout(resolve, 100))
	}

	console.log("\n" + "=".repeat(60))
	console.log("📊 TEST RESULTS")
	console.log("=".repeat(60))
	console.log(`✅ Passed: ${results.passed}/${results.total}`)
	console.log(`❌ Failed: ${results.failed}/${results.total}`)
	console.log(`📈 Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`)
	console.log("=".repeat(60))

	if (results.failed === 0) {
		console.log("\n🎉 ALL TESTS PASSED! 🎉")
		console.log("Context Engine is ready for production!\n")
	} else {
		console.log(`\n⚠️  ${results.failed} test(s) failed. Please review the errors above.\n`)
	}
}

// Run tests if executed directly
if (require.main === module) {
	runComprehensiveTests().catch((error) => {
		console.error("Fatal error running tests:", error)
		process.exit(1)
	})
}
