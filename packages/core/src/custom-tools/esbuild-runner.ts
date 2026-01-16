/**
 * esbuild-runner - Runs esbuild-wasm CLI to transpile TypeScript files.
 *
 * This module provides a way to run esbuild as a CLI process instead of using
 * the JavaScript API. This uses esbuild-wasm which is cross-platform and works
 * on all operating systems without needing native binaries.
 *
 * In production, the esbuild-wasm CLI script is bundled in dist/bin/.
 * In development, it falls back to using esbuild-wasm from node_modules.
 */

import path from "path"
import fs from "fs"
import { builtinModules } from "module"
import { fileURLToPath } from "url"
import { execa } from "execa"

/**
 * Node.js built-in modules that should never be bundled.
 * These are always available in Node.js runtime and bundling them causes issues.
 *
 * Uses Node.js's authoritative list from `module.builtinModules` and adds
 * the `node:` prefixed versions for comprehensive coverage.
 */
export const NODE_BUILTIN_MODULES: readonly string[] = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)]

/**
 * Banner code to add to bundled output.
 * This provides a CommonJS-compatible `require` function for ESM bundles,
 * which is needed when bundled npm packages use `require()` internally.
 */
export const COMMONJS_REQUIRE_BANNER = `import { createRequire as __roo_createRequire } from 'module';
var require = __roo_createRequire(import.meta.url);`

// Get the directory where this module is located.
function getModuleDir(): string | undefined {
	try {
		// In ESM context, import.meta.url is available.
		// In bundled CJS, this will throw or be undefined.
		if (typeof import.meta !== "undefined" && import.meta.url) {
			return path.dirname(fileURLToPath(import.meta.url))
		}
	} catch {
		// Ignore errors, fall through to undefined.
	}

	return undefined
}

const moduleDir = getModuleDir()

export interface EsbuildOptions {
	/** Entry point file path (absolute) */
	entryPoint: string
	/** Output file path (absolute) */
	outfile: string
	/** Output format */
	format?: "esm" | "cjs" | "iife"
	/** Target platform */
	platform?: "node" | "browser" | "neutral"
	/** Target environment (e.g., "node18") */
	target?: string
	/** Bundle dependencies */
	bundle?: boolean
	/** Generate source maps */
	sourcemap?: boolean | "inline" | "external"
	/** How to handle packages: "bundle" includes them, "external" leaves them */
	packages?: "bundle" | "external"
	/** Additional paths for module resolution */
	nodePaths?: string[]
	/** Modules to exclude from bundling (resolved at runtime) */
	external?: readonly string[]
	/** JavaScript code to prepend to the output bundle */
	banner?: string
}

/**
 * Find the esbuild-wasm CLI script by walking up the directory tree.
 * In pnpm monorepos, node_modules/esbuild-wasm is a symlink to the actual package,
 * so we don't need special pnpm handling.
 */
function findEsbuildWasmScript(startDir: string): string | null {
	const maxDepth = 10
	let currentDir = path.resolve(startDir)
	const root = path.parse(currentDir).root

	for (let i = 0; i < maxDepth && currentDir !== root; i++) {
		// Check node_modules/esbuild-wasm/bin/esbuild at this level.
		const scriptPath = path.join(currentDir, "node_modules", "esbuild-wasm", "bin", "esbuild")

		if (fs.existsSync(scriptPath)) {
			return scriptPath
		}

		// Also check src/node_modules for monorepo where src is a workspace.
		const srcScriptPath = path.join(currentDir, "src", "node_modules", "esbuild-wasm", "bin", "esbuild")

		if (fs.existsSync(srcScriptPath)) {
			return srcScriptPath
		}

		currentDir = path.dirname(currentDir)
	}

	return null
}

/**
 * Get the path to the esbuild CLI script.
 *
 * Resolution order:
 * 1. Production: Look in extension's dist/bin directory for bundled script.
 * 2. Development: Use esbuild-wasm from node_modules (relative to this module).
 * 3. Fallback: Try process.cwd() as last resort.
 *
 * @param extensionPath - Path to the extension's root directory (production)
 * @returns Path to the esbuild CLI script
 */
export function getEsbuildScriptPath(extensionPath?: string): string {
	// Production: look in extension's dist/bin directory.
	if (extensionPath) {
		const prodPath = path.join(extensionPath, "dist", "bin", "esbuild")

		if (fs.existsSync(prodPath)) {
			return prodPath
		}
	}

	// Development: use esbuild-wasm from node_modules relative to this module.
	// This works when running the extension in debug mode (if moduleDir is available).
	if (moduleDir) {
		const devPath = findEsbuildWasmScript(moduleDir)

		if (devPath) {
			return devPath
		}
	}

	// Fallback: try from cwd (for tests and other contexts).
	const cwdPath = findEsbuildWasmScript(process.cwd())

	if (cwdPath) {
		return cwdPath
	}

	throw new Error("esbuild-wasm CLI not found. Ensure esbuild-wasm is installed.")
}

/**
 * Run esbuild CLI to bundle a TypeScript file.
 *
 * Uses esbuild-wasm which is cross-platform and runs via Node.js.
 *
 * @param options - Build options
 * @param extensionPath - Path to extension root (for finding bundled script)
 * @returns Promise that resolves when build completes
 * @throws Error if the build fails
 */
export async function runEsbuild(options: EsbuildOptions, extensionPath?: string): Promise<void> {
	const scriptPath = getEsbuildScriptPath(extensionPath)

	const args: string[] = [
		scriptPath,
		options.entryPoint,
		`--outfile=${options.outfile}`,
		`--format=${options.format ?? "esm"}`,
		`--platform=${options.platform ?? "node"}`,
		`--target=${options.target ?? "node18"}`,
	]

	if (options.bundle !== false) {
		args.push("--bundle")
	}

	if (options.sourcemap) {
		args.push(options.sourcemap === true ? "--sourcemap" : `--sourcemap=${options.sourcemap}`)
	}

	if (options.packages) {
		args.push(`--packages=${options.packages}`)
	}

	// Add external modules - these won't be bundled and will be resolved at runtime.
	if (options.external && options.external.length > 0) {
		for (const ext of options.external) {
			args.push(`--external:${ext}`)
		}
	}

	// Add banner code (e.g., for CommonJS require shim in ESM bundles).
	if (options.banner) {
		args.push(`--banner:js=${options.banner}`)
	}

	// Build environment with NODE_PATH for module resolution.
	const env: NodeJS.ProcessEnv = { ...process.env }

	if (options.nodePaths && options.nodePaths.length > 0) {
		env.NODE_PATH = options.nodePaths.join(path.delimiter)
	}

	try {
		await execa(process.execPath, args, { env, stdin: "ignore" })
	} catch (error) {
		const execaError = error as { stderr?: string; stdout?: string; exitCode?: number; message: string }
		const errorMessage = execaError.stderr || execaError.stdout || `esbuild exited with code ${execaError.exitCode}`
		throw new Error(`esbuild failed: ${errorMessage}`)
	}
}
