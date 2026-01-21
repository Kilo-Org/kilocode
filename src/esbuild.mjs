import * as esbuild from "esbuild"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"
import { createRequire } from "module"
import process from "node:process"
import * as console from "node:console"

import { copyPaths, copyWasms, copyLocales, setupLocaleWatcher } from "@roo-code/build"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function main() {
	const name = "extension"
	const production = process.argv.includes("--production")
	const watch = process.argv.includes("--watch")
	const minify = production
	const sourcemap = true // Always generate source maps for error handling.

	/**
	 * @type {import('esbuild').BuildOptions}
	 */
	const buildOptions = {
		bundle: true,
		minify,
		sourcemap,
		logLevel: "silent",
		format: "cjs",
		sourcesContent: false,
		platform: "node",
		// kilocode_change start: for ps-list
		banner: {
			js: "const __importMetaUrl = typeof __filename !== 'undefined' ? require('url').pathToFileURL(__filename).href : undefined;",
		},
		// kilocode_change end
	}

	const srcDir = __dirname
	const buildDir = __dirname
	const distDir = path.join(buildDir, "dist")

	if (fs.existsSync(distDir)) {
		console.log(`[${name}] Cleaning dist directory: ${distDir}`)
		fs.rmSync(distDir, { recursive: true, force: true })
	}

	/**
	 * @type {import('esbuild').Plugin[]}
	 */
	const plugins = [
		// kilocode_change start
		{
			name: "import-meta-url-plugin",
			setup(build) {
				build.onLoad({ filter: /\.js$/ }, async (args) => {
					const fs = await import("fs")
					let contents = await fs.promises.readFile(args.path, "utf8")

					// Replace import.meta.url with our polyfill
					if (contents.includes("import.meta.url")) {
						contents = contents.replace(/import\.meta\.url/g, "__importMetaUrl")
					}

					return { contents, loader: "js" }
				})
			},
		},
		// kilocode_change end
		{
			name: "copyFiles",
			setup(build) {
				build.onEnd(() => {
					copyPaths(
						[
							["../README.md", "README.md"],
							["../CHANGELOG.md", "CHANGELOG.md"],
							["../LICENSE", "LICENSE"],
							["../.env", ".env", { optional: true }],
							["node_modules/vscode-material-icons/generated", "assets/vscode-material-icons"],
							["../webview-ui/audio", "webview-ui/audio"],
						],
						srcDir,
						buildDir,
					)

					// Copy walkthrough files to dist directory
					copyPaths([["walkthrough", "walkthrough"]], srcDir, distDir)

					// Copy tree-sitter files to dist directory
					copyPaths([["services/continuedev/tree-sitter", "tree-sitter"]], srcDir, distDir)

					// Copy JSDOM xhr-sync-worker.js to fix runtime resolution
					const jsdomWorkerDest = path.join(distDir, "xhr-sync-worker.js")

					try {
						const require = createRequire(import.meta.url)
						const jsdomModulePath = require.resolve("jsdom/package.json")
						const jsdomDir = path.dirname(jsdomModulePath)
						const jsdomWorkerSource = path.join(jsdomDir, "lib/jsdom/living/xhr/xhr-sync-worker.js")

						if (fs.existsSync(jsdomWorkerSource)) {
							fs.copyFileSync(jsdomWorkerSource, jsdomWorkerDest)
							console.log(`[${name}] Copied JSDOM xhr-sync-worker.js to dist from: ${jsdomWorkerSource}`)
						}
					} catch (error) {
						console.error(`[${name}] Failed to copy JSDOM xhr-sync-worker.js:`, error.message)
					}
				})
			},
		},
		{
			name: "copyWasms",
			setup(build) {
				build.onEnd(() => copyWasms(srcDir, distDir))
			},
		},
		{
			name: "copyLocales",
			setup(build) {
				build.onEnd(() => copyLocales(srcDir, distDir))
			},
		},
		{
			name: "esbuild-problem-matcher",
			setup(build) {
				build.onStart(() => console.log("[esbuild-problem-matcher#onStart]"))
				build.onEnd((result) => {
					result.errors.forEach(({ text, location }) => {
						console.error(`✘ [ERROR] ${text}`)
						if (location && location.file) {
							console.error(`    ${location.file}:${location.line}:${location.column}:`)
						}
					})

					console.log("[esbuild-problem-matcher#onEnd]")
				})
			},
		},
	]

	/**
	 * @type {import('esbuild').BuildOptions}
	 */
	const extensionConfig = {
		...buildOptions,
		plugins,
		entryPoints: ["extension.ts"],
		outfile: "dist/extension.js",
		external: ["vscode", "esbuild", "@lancedb/lancedb"],
	}

	/**
	 * @type {import('esbuild').BuildOptions}
	 */
	const workerConfig = {
		...buildOptions,
		entryPoints: ["workers/countTokens.ts"],
		outdir: "dist/workers",
	}

	// kilocode_change start - agent-runtime process bundle
	/**
	 * Agent Runtime Process Bundle
	 *
	 * This bundles the agent-runtime process.ts into a standalone file that can be
	 * forked by the Agent Manager. fork() requires a physical .js file on disk,
	 * so we bundle it separately from the main extension.
	 *
	 * @type {import('esbuild').BuildOptions}
	 */
	const agentRuntimeDir = path.join(srcDir, "..", "packages/agent-runtime")
	const agentRuntimeProcessConfig = {
		...buildOptions,
		entryPoints: [path.join(agentRuntimeDir, "src/process.ts")],
		outfile: "dist/agent-runtime-process.js",
		// The agent-runtime process loads the main extension bundle dynamically,
		// so vscode APIs come from the extension, not from direct imports
		external: ["vscode"],
		// Use CJS format - works reliably with fork() and dynamic require() in dependencies
		format: "cjs",
		// Ensure we can resolve workspace packages
		plugins: [
			{
				name: "resolve-workspace-packages",
				setup(build) {
					// Resolve @roo-code/types and other workspace packages
					build.onResolve({ filter: /^@roo-code\// }, (args) => {
						const packageName = args.path
						const packagePath = path.join(srcDir, "..", "packages", packageName.replace("@roo-code/", ""))
						return { path: path.join(packagePath, "src/index.ts") }
					})
					build.onResolve({ filter: /^@kilocode\// }, (args) => {
						const packageName = args.path
						const packagePath = path.join(srcDir, "..", "packages", packageName.replace("@kilocode/", ""))
						return { path: path.join(packagePath, "src/index.ts") }
					})
				},
			},
		],
	}
	// kilocode_change end

	const [extensionCtx, workerCtx, agentRuntimeCtx] = await Promise.all([ // kilocode_change
		esbuild.context(extensionConfig),
		esbuild.context(workerConfig),
		esbuild.context(agentRuntimeProcessConfig), // kilocode_change
	])

	if (watch) {
		await Promise.all([extensionCtx.watch(), workerCtx.watch(), agentRuntimeCtx.watch()]) // kilocode_change
		copyLocales(srcDir, distDir)
		setupLocaleWatcher(srcDir, distDir)
	} else {
		await Promise.all([extensionCtx.rebuild(), workerCtx.rebuild(), agentRuntimeCtx.rebuild()]) // kilocode_change
		await Promise.all([extensionCtx.dispose(), workerCtx.dispose(), agentRuntimeCtx.dispose()]) // kilocode_change
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
