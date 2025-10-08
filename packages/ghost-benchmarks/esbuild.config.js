import esbuild from "esbuild"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const config = {
	entryPoints: ["runner.ts"],
	bundle: true,
	platform: "node",
	target: "node20",
	format: "esm",
	outfile: "dist/runner.js",
	external: [
		// Keep these as external dependencies
		"electron",
		"tiktoken", // Has WASM dependencies that can't be bundled
		"tree-sitter-wasms", // WASM files
		"web-tree-sitter", // WASM files
		"openai",
		"dotenv",
		"@anthropic-ai/sdk",
	],
	alias: {
		// Map workspace dependencies to actual packages
		"@roo-code/telemetry": path.resolve(__dirname, "../telemetry/src"),
		"@roo-code/types": path.resolve(__dirname, "../types/src"),
		"@roo-code/ipc": path.resolve(__dirname, "../ipc/src"),
		"@roo-code/cloud": path.resolve(__dirname, "../cloud/src"),
		// Mock vscode module
		vscode: path.resolve(__dirname, "mock-vscode.ts"),
	},
	plugins: [],
	define: {},
	resolveExtensions: [".ts", ".js", ".json"],
	sourcemap: true,
	minify: false, // Keep readable for debugging
	logLevel: "info",
	mainFields: ["module", "main"],
	conditions: ["import", "require", "node"],
}

// Build function
async function build() {
	try {
		console.log("🔨 Building Ghost Benchmarks with esbuild...")
		await esbuild.build(config)
		console.log("✅ Build completed successfully!")
	} catch (error) {
		console.error("❌ Build failed:", error)
		process.exit(1)
	}
}

// Run build if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	build()
}

export { config, build }
