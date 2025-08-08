import { CLIProvider } from "@kilo-code/vscode-mock"
import { CLIConfig } from "./core/CLIConfig"
import { logger } from "./utils/Logger"

export interface CLIBootstrapOptions {
	workingDirectory?: string
	configPath?: string
}

/**
 * Wrap VS Code module with comprehensive logging to identify API calls and potential hangs
 */
function wrapVSCodeModuleWithLogging(vscodeModule: any) {
	// Helper function to create a logging proxy for any object
	function createLoggingProxy(obj: any, path: string): any {
		if (!obj || typeof obj !== "object") {
			return obj
		}

		return new Proxy(obj, {
			get(target, prop, receiver) {
				const value = Reflect.get(target, prop, receiver)
				const fullPath = `${path}.${String(prop)}`

				// Skip logging for common properties that would spam the logs
				if (
					typeof prop === "string" &&
					(prop.startsWith("_") ||
						prop === "constructor" ||
						prop === "toString" ||
						prop === "valueOf" ||
						prop === "Symbol.iterator")
				) {
					return value
				}

				// If it's a function, wrap it with logging
				if (typeof value === "function") {
					return function (this: any, ...args: any[]) {
						try {
							const result = value.apply(this, args)

							// If it returns a Promise, log when it resolves/rejects
							if (result && typeof result.then === "function") {
								return result.then(
									(resolved: any) => {
										return resolved
									},
									(rejected: any) => {
										throw rejected
									},
								)
							} else {
								return result
							}
						} catch (error) {
							throw error
						}
					}
				}

				// If it's an object, recursively wrap it (but avoid infinite recursion)
				if (value && typeof value === "object" && !Array.isArray(value)) {
					// Don't wrap certain objects to avoid issues
					if (value.constructor === Object || value.constructor.name.includes("Mock")) {
						return createLoggingProxy(value, fullPath)
					}
				}

				return value
			},
		})
	}

	// Wrap the main vscode module sections
	const wrappedModule = {
		...vscodeModule,
		workspace: createLoggingProxy(vscodeModule.workspace, "vscode.workspace"),
		window: createLoggingProxy(vscodeModule.window, "vscode.window"),
		commands: createLoggingProxy(vscodeModule.commands, "vscode.commands"),
		env: createLoggingProxy(vscodeModule.env, "vscode.env"),
	}

	return wrappedModule
}

/**
 * Set up CLI-specific state in the VS Code mock
 * This ensures that the ContextProxy returns the correct experiments and other CLI settings
 */
async function setupCLISpecificState(cliProvider: CLIProvider) {
	logger.debug("Setting up CLI-specific state...")

	// Get the VS Code API and extension context
	const vscodeAPI = cliProvider.getVSCodeAPI()
	const context = vscodeAPI.createExtensionContext()

	// CRITICAL: Initialize CLI with Code mode to prevent file operation restrictions
	logger.debug("Initializing CLI with Code mode...")
	await context.globalState.update("mode", "code")

	// Set up other CLI-specific defaults
	await context.globalState.update("alwaysAllowWrite", true)
	await context.globalState.update("alwaysAllowReadOnly", true)
	await context.globalState.update("alwaysAllowExecute", true)
	await context.globalState.update("autoApprovalEnabled", true)

	// Set up experiments configuration for CLI mode
	// This is critical for the preventFocusDisruption experiment to work
	const cliExperiments = {
		preventFocusDisruption: true, // Enable direct file writing without diff editor
		morphFastApply: false,
		multiFileApplyDiff: false,
		powerSteering: false,
		inlineAssist: false,
	}

	// Store experiments in global state so ContextProxy can find them
	await context.globalState.update("experiments", cliExperiments)

	// Also set other CLI-specific defaults
	await context.globalState.update("diagnosticsEnabled", true)
	await context.globalState.update("writeDelayMs", 0) // No delay for CLI
	await context.globalState.update("diffEnabled", false) // Disable diff view for CLI
	await context.globalState.update("alwaysAllowReadOnly", true)
	await context.globalState.update("alwaysAllowWrite", true)
	await context.globalState.update("alwaysAllowExecute", true)
	await context.globalState.update("alwaysAllowBrowser", true)
	await context.globalState.update("alwaysAllowMcp", true)

	logger.debug("CLI-specific state configured:", {
		experiments: cliExperiments,
		diagnosticsEnabled: true,
		writeDelayMs: 0,
		diffEnabled: false,
	})
}

/**
 * Initialize CLI environment with VS Code mocking
 * This sets up a fake VS Code environment that allows existing src/ code to run unchanged
 */
export async function initializeCLI(options: CLIBootstrapOptions = {}) {
	// Mock CloudService FIRST before any other imports
	setupCloudServiceMock()

	// Load CLI configuration
	const cliConfig = new CLIConfig(options.configPath, options.workingDirectory)
	await cliConfig.loadDefaults()

	// Validate configuration
	const configErrors = cliConfig.validate()
	if (configErrors.length > 0) {
		logger.error("Configuration errors:")
		configErrors.forEach((error) => logger.error(`  - ${error}`))
		throw new Error("Invalid configuration. Please check your settings.")
	}

	// Set up comprehensive fake VS Code environment
	const cliProvider = new CLIProvider(options.workingDirectory || process.cwd())
	cliProvider.initialize()

	// Create the mock VS Code module
	const vscodeModule = cliProvider.createVSCodeModule()

	// Wrap the VS Code module with comprehensive logging
	const wrappedVSCodeModule = wrapVSCodeModuleWithLogging(vscodeModule)

	// Map CLI configuration to VS Code configuration format
	await mapCLIConfigToVSCode(cliConfig, wrappedVSCodeModule)

	// Note: CLI-specific state setup is now handled in TaskCommand.ts via getState() override
	logger.debug("CLI bootstrap completed - state override will be applied in TaskCommand")

	// Set up global vscode object before any imports from src/
	// This ensures that when src/ code imports 'vscode', it gets our mock
	;(global as any).vscode = {
		...wrappedVSCodeModule,
		// Add UIKind enum that getStateToPostToWebview expects
		UIKind: {
			Desktop: 1,
			Web: 2,
		},
	}

	// Ripgrep path resolution is now handled in CLIProvider
	await setupRipgrepPathWorkaround()

	// Create a mock extension context
	const mockContext = cliProvider.getVSCodeAPI().createExtensionContext()

	return {
		mockContext,
		cliProvider,
		vscodeModule,
		cliConfig,
		// Helper function to import src/ modules after VS Code mocking is set up
		importFromSrc: async <T = any>(modulePath: string): Promise<T> => {
			try {
				// Use require.resolve to get the absolute path
				const absolutePath = require.resolve(modulePath)
				// Clear the module cache to ensure fresh import with mocked vscode
				delete require.cache[absolutePath]
				// Import the module
				return require(absolutePath)
			} catch (error) {
				logger.error(`Failed to import ${modulePath}:`, error)
				throw new Error(
					`Failed to import ${modulePath}: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		},
	}
}

/**
 * Map CLI configuration to VS Code configuration format
 * This ensures that src/ code can access configuration through vscode.workspace.getConfiguration()
 */
async function mapCLIConfigToVSCode(cliConfig: CLIConfig, vscodeModule: any): Promise<void> {
	const config = cliConfig.getAll()

	// Map CLI config to kilocode extension configuration
	const kilocodeConfig = vscodeModule.workspace.getConfiguration("kilocode")

	// Map provider settings
	if (config.provider) {
		await kilocodeConfig.update("provider", config.provider)
	}

	if (config.model) {
		await kilocodeConfig.update("model", config.model)
	}

	if (config.apiKey) {
		// Map API key based on provider
		if (config.provider === "anthropic") {
			await kilocodeConfig.update("anthropicApiKey", config.apiKey)
		} else if (config.provider === "openai") {
			await kilocodeConfig.update("openaiApiKey", config.apiKey)
		} else if (config.provider === "openrouter") {
			await kilocodeConfig.update("openrouterApiKey", config.apiKey)
		}
	}

	if (config.baseUrl) {
		await kilocodeConfig.update("baseUrl", config.baseUrl)
	}

	if (config.maxTokens) {
		await kilocodeConfig.update("maxTokens", config.maxTokens)
	}

	if (config.temperature !== undefined) {
		await kilocodeConfig.update("temperature", config.temperature)
	}

	// Also set environment variables that some parts of the code might expect
	if (config.apiKey) {
		if (config.provider === "anthropic") {
			process.env.ANTHROPIC_API_KEY = config.apiKey
		} else if (config.provider === "openrouter") {
			process.env.OPENROUTER_API_KEY = config.apiKey
		} else if (config.provider === "openai") {
			process.env.OPENAI_API_KEY = config.apiKey
		}
	}

	logger.debug("Mapped CLI config to VS Code configuration:")
	logger.debug(`  Provider: ${config.provider}`)
	logger.debug(`  Model: ${config.model}`)
	logger.debug(`  API Key: ${config.apiKey ? "***" + config.apiKey.slice(-4) : "not set"}`)
}

export type CLIBootstrapResult = Awaited<ReturnType<typeof initializeCLI>>

/**
 * Helper function to set up VS Code module aliasing at runtime
 * This should be called before importing any src/ modules
 */
export function setupVSCodeModuleAlias(vscodeModule: any) {
	// Override the require function to intercept 'vscode' imports
	const originalRequire = require
	const Module = require("module")
	const originalLoad = Module._load

	Module._load = function (request: string, parent: any) {
		if (request === "vscode") {
			return vscodeModule
		}
		return originalLoad.apply(this, arguments)
	}
}

/**
 * Workaround for ripgrep path resolution issues
 * This patches the global environment to ensure ripgrep can be found and automatically installs it if missing
 */
async function setupRipgrepPathWorkaround() {
	const path = require("path")
	const fs = require("fs")

	// Start from current working directory and walk up to find workspace root
	let workspaceRoot = process.cwd()

	// Walk up to find the workspace root (where pnpm-workspace.yaml or package.json with workspaces exists)
	while (workspaceRoot !== path.dirname(workspaceRoot)) {
		const pnpmWorkspace = path.join(workspaceRoot, "pnpm-workspace.yaml")
		const packageJson = path.join(workspaceRoot, "package.json")

		if (
			fs.existsSync(pnpmWorkspace) ||
			(fs.existsSync(packageJson) && JSON.parse(fs.readFileSync(packageJson, "utf8")).workspaces)
		) {
			break
		}
		workspaceRoot = path.dirname(workspaceRoot)
	}

	// Check for ripgrep in workspace root node_modules (pnpm structure)
	const ripgrepPaths = [
		path.join(workspaceRoot, "node_modules", "@vscode", "ripgrep"),
		path.join(
			workspaceRoot,
			"node_modules",
			".pnpm",
			"@vscode+ripgrep@1.15.14",
			"node_modules",
			"@vscode",
			"ripgrep",
		),
	]

	let ripgrepRoot = workspaceRoot
	let ripgrepPackagePath = null

	for (const ripgrepPath of ripgrepPaths) {
		if (fs.existsSync(ripgrepPath)) {
			ripgrepRoot = workspaceRoot
			ripgrepPackagePath = ripgrepPath
			logger.debug(`Found ripgrep package at: ${ripgrepPath}`)
			break
		}
	}

	// Check if ripgrep binary exists, if not, install it automatically
	if (ripgrepPackagePath) {
		const ripgrepBinPath = path.join(ripgrepPackagePath, "bin", "rg")
		const ripgrepBinDir = path.join(ripgrepPackagePath, "bin")

		if (!fs.existsSync(ripgrepBinDir) || !fs.existsSync(ripgrepBinPath)) {
			logger.verbose("Ripgrep binary not found, installing automatically...")

			try {
				// Run the postinstall script to download ripgrep binary
				const postinstallPath = path.join(ripgrepPackagePath, "lib", "postinstall.js")
				if (fs.existsSync(postinstallPath)) {
					const { spawn } = require("child_process")

					await new Promise((resolve, reject) => {
						const postinstall = spawn("node", [postinstallPath], {
							cwd: ripgrepPackagePath,
							stdio: ["inherit", "pipe", "pipe"],
						})

						let output = ""
						let errorOutput = ""

						postinstall.stdout.on("data", (data: Buffer) => {
							const text = data.toString()
							output += text
							// Show progress but keep it concise
							if (text.includes("Downloading") || text.includes("Unzipping")) {
								logger.verbose(text.trim())
							}
						})

						postinstall.stderr.on("data", (data: Buffer) => {
							errorOutput += data.toString()
						})

						postinstall.on("close", (code: number) => {
							if (code === 0) {
								logger.verbose("✅ Ripgrep binary installed successfully")
								resolve(void 0)
							} else {
								logger.error(`❌ Failed to install ripgrep binary (exit code: ${code})`)
								if (errorOutput) logger.error(`Error: ${errorOutput}`)
								reject(new Error(`Ripgrep installation failed with exit code: ${code}`))
							}
						})

						postinstall.on("error", (error: Error) => {
							logger.error(`❌ Error running ripgrep postinstall: ${error.message}`)
							reject(error)
						})
					})
				} else {
					logger.warn(`⚠️  Postinstall script not found at: ${postinstallPath}`)
				}
			} catch (error) {
				logger.error(`❌ Failed to install ripgrep binary:`, error)
				// Don't throw - continue with fallback behavior
			}
		} else {
			logger.debug(`Ripgrep binary already exists at: ${ripgrepBinPath}`)
		}
	}

	// Set environment variable that can be used as fallback
	process.env.KILO_CLI_RIPGREP_ROOT = ripgrepRoot

	// Also try to patch the global vscode object if it exists
	if ((global as any).vscode && (global as any).vscode.env) {
		;(global as any).vscode.env.appRoot = ripgrepRoot
	}

	// AGGRESSIVE WORKAROUND: Monkey-patch the getBinPath function
	// This directly replaces the function that's causing issues
	const originalRequire = require
	const Module = require("module")
	const originalLoad = Module._load

	Module._load = function (request: string, parent: any) {
		const result = originalLoad.apply(this, arguments)

		// If this is the ripgrep module being loaded, patch it
		if (request.includes("ripgrep") || (result && typeof result.getBinPath === "function")) {
			const originalGetBinPath = result.getBinPath
			result.getBinPath = async function (vscodeAppRoot: string) {
				// Use our known workspace root instead of the undefined vscodeAppRoot
				const actualAppRoot = vscodeAppRoot || ripgrepRoot
				logger.debug(`getBinPath called with: ${vscodeAppRoot}, using: ${actualAppRoot}`)
				return originalGetBinPath.call(this, actualAppRoot)
			}
		}

		return result
	}

	logger.debug(`Ripgrep root set to: ${ripgrepRoot}`)
}

/**
 * Mock CloudService to prevent CLI errors
 */
function setupCloudServiceMock() {
	// Mock the @roo-code/cloud module
	const Module = require("module")
	const originalLoad = Module._load

	Module._load = function (request: string, parent: any) {
		if (request === "@roo-code/cloud") {
			return {
				CloudService: {
					hasInstance: () => false, // Indicate CloudService is not available in CLI mode
					isEnabled: () => false,
					instance: {
						getAllowList: async () => null,
						getUserInfo: () => null,
						isAuthenticated: () => false,
						canShareTask: async () => false,
						getOrganizationSettings: () => null,
						getOrganizationId: () => null,
						getStoredOrganizationId: () => null,
						hasOrIsAcquiringActiveSession: () => false,
						captureEvent: () => {},
						shareTask: async () => ({ success: false, message: "CloudService not available in CLI mode" }),
						login: async () => {},
						logout: async () => {},
						handleAuthCallback: async () => {},
					},
				},
				getRooCodeApiUrl: () => "https://api.roo.dev",
				getClerkBaseUrl: () => "https://clerk.roo.dev",
				PRODUCTION_CLERK_BASE_URL: "https://clerk.roo.dev",
			}
		}
		return originalLoad.apply(this, arguments)
	}

	logger.debug("CloudService mock initialized for CLI mode")
}
