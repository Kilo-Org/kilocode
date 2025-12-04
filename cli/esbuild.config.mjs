/* eslint-disable no-undef */
import esbuild from "esbuild"
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chmodSync, mkdirSync, copyFileSync } from "fs"
import { rimrafSync } from "rimraf"

// ESM Polyfill
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to copy post-build files
function copyPostBuildFiles() {
	try {
		mkdirSync("dist/config", { recursive: true })

		copyFileSync("src/config/schema.json", "dist/config/schema.json")
		copyFileSync("package.dist.json", "dist/package.json")
		copyFileSync("npm-shrinkwrap.dist.json", "dist/npm-shrinkwrap.json")
		copyFileSync("README.md", "dist/README.md")

		try {
			copyFileSync(".env", "dist/.env")
			copyFileSync(".env", "dist/kilocode/.env")
		} catch {
			// .env might not exist, that's okay
		}

		console.log("✓ Post-build files copied")
	} catch (err) {
		console.error("Error copying post-build files:", err)
	}
}

function removeUnneededFiles() {
	rimrafSync("dist/kilocode/webview-ui")
	rimrafSync("dist/kilocode/assets")
	console.log("✓ Unneeded files removed")
}

const afterBuildPlugin = {
	name: "after-build",
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length > 0) return

			copyPostBuildFiles()
			removeUnneededFiles()
			try {
				chmodSync("dist/index.js", 0o755)
				console.log("✓ dist/index.js made executable")
			} catch (err) {
				console.error("Error making dist/index.js executable:", err)
			}
		})
	},
}

const config = {
	entryPoints: ["src/index.ts"],
	bundle: true,
	platform: "node",
	target: "node20",
	format: "esm",
	outfile: "dist/index.js",
	banner: {
		js: `import { createRequire as __createRequire__ } from 'module';
import { fileURLToPath as __fileURLToPath__ } from 'url';
import { dirname as __dirname__ } from 'path';
const require = __createRequire__(import.meta.url);
const __filename = __fileURLToPath__(import.meta.url);
const __dirname = __dirname__(__filename);
`,
	},
	external: [
		// Keep these as external dependencies (will be installed via npm)
		"@anthropic-ai/bedrock-sdk",
		"@anthropic-ai/sdk",
		"@anthropic-ai/vertex-sdk",
		"@aws-sdk/client-bedrock-runtime",
		"@aws-sdk/credential-providers",
		"@google/genai",
		"@lmstudio/sdk",
		"@mistralai/mistralai",
		"@modelcontextprotocol/sdk",
		"@qdrant/js-client-rest",
		"@vscode/codicons",
		"@vscode/ripgrep",
		"async-mutex",
		"axios",
		"chalk",
		"cheerio",
		"chokidar",
		"clone-deep",
		"commander",
		"default-shell",
		"delay",
		"diff",
		"diff-match-patch",
		"dotenv",
		"eventemitter3",
		"fast-deep-equal",
		"fast-glob",
		"fast-xml-parser",
		"fastest-levenshtein",
		"fs-extra",
		"fuse.js",
		"fzf",
		"get-folder-size",
		"google-auth-library",
		"gray-matter",
		"i18next",
		"ignore",
		"is-wsl",
		"isbinaryfile",
		"jotai",
		"jsdom",
		"json5",
		"jwt-decode",
		"lodash.debounce",
		"lru-cache",
		"mammoth",
		"marked",
		"marked-terminal",
		"monaco-vscode-textmate-theme-converter",
		"node-cache",
		"node-ipc",
		"ollama",
		"openai",
		"os-name",
		"p-limit",
		"p-wait-for",
		"pdf-parse",
		"pkce-challenge",
		"pretty-bytes",
		"proper-lockfile",
		"ps-list",
		"puppeteer-chromium-resolver",
		"puppeteer-core",
		"react",
		"reconnecting-eventsource",
		"sanitize-filename",
		"say",
		"semver",
		"serialize-error",
		"shiki",
		"simple-git",
		"socket.io-client",
		"sound-play",
		"stream-json",
		"strip-bom",
		"tiktoken",
		"tmp",
		"tree-sitter-wasms",
		"ts-node",
		"turndown",
		"undici",
		"uri-js",
		"uuid",
		"vscode-material-icons",
		"vscode-uri",
		"web-tree-sitter",
		"workerpool",
		"xlsx",
		"yaml",
		"zod",
	],
	sourcemap: false,
	minify: false,
	treeShaking: true,
	logLevel: "info",
	plugins: [afterBuildPlugin],
	alias: {
		'is-in-ci': path.resolve(__dirname, 'src/patches/is-in-ci.ts'),
	}
}

if (process.argv.includes("--watch")) {
	const ctx = await esbuild.context(config)
	await ctx.watch()
	console.log("Watching for changes...")
} else {
	// Single build
	await esbuild.build(config)
}
