import { VSCodeAPI } from "../api/VSCodeAPI"
import { FileSystemAdapter, IFileSystemAdapter } from "../adapters/FileSystemAdapter"
import { UserInterfaceAdapter, IUserInterfaceAdapter } from "../adapters/UserInterfaceAdapter"
import { TelemetryService } from "@roo-code/telemetry"

export class CLIProvider {
	private fileSystemAdapter: IFileSystemAdapter
	private userInterfaceAdapter: IUserInterfaceAdapter
	private vscodeAPI: VSCodeAPI

	constructor(workingDirectory?: string) {
		this.fileSystemAdapter = new FileSystemAdapter(workingDirectory)
		this.userInterfaceAdapter = new UserInterfaceAdapter()

		// For CLI, we need to set appRoot to the CLI package directory where ripgrep is installed
		// The workingDirectory is where the user is running the CLI from
		// But appRoot should point to where the CLI package and its dependencies are located
		const cliPackageDir = this.findCLIPackageDirectory()
		this.vscodeAPI = new VSCodeAPI(this.fileSystemAdapter, this.userInterfaceAdapter, cliPackageDir)

		// Initialize TelemetryService for CLI environment
		this.initializeTelemetryService()
	}

	private findCLIPackageDirectory(): string {
		// Try to find the workspace root directory by looking for ripgrep in various locations
		const path = require("path")
		const fs = require("fs")

		// Start from current working directory and walk up to find workspace root
		let currentDir = process.cwd()

		while (currentDir !== path.dirname(currentDir)) {
			// Check for workspace indicators (pnpm-workspace.yaml or package.json with workspaces)
			const pnpmWorkspace = path.join(currentDir, "pnpm-workspace.yaml")
			const packageJson = path.join(currentDir, "package.json")

			const isWorkspaceRoot =
				fs.existsSync(pnpmWorkspace) ||
				(fs.existsSync(packageJson) && JSON.parse(fs.readFileSync(packageJson, "utf8")).workspaces)

			if (isWorkspaceRoot) {
				// Check for ripgrep in various pnpm locations
				const ripgrepPaths = [
					path.join(currentDir, "node_modules", "@vscode", "ripgrep"),
					path.join(
						currentDir,
						"node_modules",
						".pnpm",
						"@vscode+ripgrep@1.15.14",
						"node_modules",
						"@vscode",
						"ripgrep",
					),
				]

				for (const ripgrepPath of ripgrepPaths) {
					if (fs.existsSync(ripgrepPath)) {
						return currentDir
					}
				}
			}

			currentDir = path.dirname(currentDir)
		}

		// Fallback: try to detect if we're in the CLI package directory
		const packageJsonPath = path.join(process.cwd(), "package.json")
		if (fs.existsSync(packageJsonPath)) {
			try {
				const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
				if (packageJson.name === "@kilo-code/cli") {
					return process.cwd()
				}
			} catch (e) {
				// Ignore parsing errors
			}
		}

		// Final fallback: use current working directory
		return process.cwd()
	}

	initialize(): void {
		this.userInterfaceAdapter.initialize()
	}

	private initializeTelemetryService(): void {
		// Check if TelemetryService is already initialized
		if (!TelemetryService.hasInstance()) {
			// Create a minimal telemetry instance for CLI
			TelemetryService.createInstance([])

			// Disable telemetry in CLI mode by default
			TelemetryService.instance.updateTelemetryState(false)
		}
	}

	getVSCodeAPI(): VSCodeAPI {
		return this.vscodeAPI
	}

	getFileSystemAdapter(): IFileSystemAdapter {
		return this.fileSystemAdapter
	}

	getUserInterfaceAdapter(): IUserInterfaceAdapter {
		return this.userInterfaceAdapter
	}

	setWorkingDirectory(directory: string): void {
		this.fileSystemAdapter.setWorkingDirectory(directory)
	}

	getWorkingDirectory(): string {
		return this.fileSystemAdapter.getWorkingDirectory()
	}

	/**
	 * Implement getState() method that tools expect to be available on the provider
	 * This enables experiments like PREVENT_FOCUS_DISRUPTION for direct file writing
	 * and provides API configuration for task execution
	 */
	async getState() {
		// Get the current VS Code configuration which should have the API settings
		const vscodeConfig = this.vscodeAPI.workspace.getConfiguration()

		const state = {
			// API configuration is crucial for task execution
			apiConfiguration: {
				apiProvider: vscodeConfig.get("kilocode.provider") || "openrouter",
				openrouterApiKey: vscodeConfig.get("kilocode.openrouterApiKey"),
				baseUrl: vscodeConfig.get("kilocode.baseUrl"),
				maxTokens: vscodeConfig.get("kilocode.maxTokens"),
				temperature: vscodeConfig.get("kilocode.temperature"),
			},
			apiModelId: vscodeConfig.get("kilocode.model"),
			experiments: {
				// Use the exact keys from EXPERIMENT_IDS to ensure experiments.isEnabled() works correctly
				preventFocusDisruption: true, // Enable to bypass diff view and write files directly in CLI
				morphFastApply: false,
				multiFileApplyDiff: false,
				powerSteering: false,
				inlineAssist: false,
			},
			// Add other minimal state properties that tools might expect
			diagnosticsEnabled: true,
			writeDelayMs: 0, // No delay for CLI
			diffEnabled: false, // Disable diff view for CLI
			alwaysAllowReadOnly: true,
			alwaysAllowWrite: true,
			alwaysAllowExecute: true,
			alwaysAllowBrowser: true,
			alwaysAllowMcp: true,
		}

		return state
	}

	// Create a mock vscode module that can be used in place of the real vscode module
	createVSCodeModule() {
		const api = this.vscodeAPI
		return {
			workspace: api.workspace,
			window: api.window,
			commands: api.commands,
			env: api.env,
			languages: {
				registerCompletionItemProvider: () => ({ dispose: () => {} }),
				registerHoverProvider: () => ({ dispose: () => {} }),
				registerDefinitionProvider: () => ({ dispose: () => {} }),
			},
			extensions: {
				getExtension: () => undefined,
				all: [],
			},
			ExtensionContext: api.createExtensionContext(),
			// Add other vscode module exports as needed
			Uri: {
				file: (path: string) => ({
					fsPath: path,
					scheme: "file",
					authority: "",
					path: path,
					query: "",
					fragment: "",
					toString: () => `file://${path}`,
					with: (change: any) => ({ ...this, ...change }),
				}),
				parse: (uri: string) => ({
					fsPath: uri,
					scheme: "file",
					authority: "",
					path: uri,
					query: "",
					fragment: "",
					toString: () => uri,
					with: (change: any) => ({ ...this, ...change }),
				}),
			},
			Range: class Range {
				constructor(
					public start: any,
					public end: any,
				) {}
			},
			Position: class Position {
				constructor(
					public line: number,
					public character: number,
				) {}
			},
			Selection: class Selection {
				constructor(
					public anchor: any,
					public active: any,
				) {}
			},
			RelativePattern: class RelativePattern {
				constructor(
					public base: string | any,
					public pattern: string,
				) {}
			},
			Disposable: class Disposable {
				constructor(public callOnDispose?: () => void) {}

				dispose() {
					if (this.callOnDispose) {
						this.callOnDispose()
					}
				}

				static from(...disposables: any[]) {
					return new Disposable(() => {
						disposables.forEach((d) => d?.dispose?.())
					})
				}
			},
			// VS Code constants
			StatusBarAlignment: {
				Left: 1,
				Right: 2,
			},
			ViewColumn: {
				One: 1,
				Two: 2,
				Three: 3,
				Active: -1,
				Beside: -2,
			},
			ProgressLocation: {
				SourceControl: 1,
				Window: 10,
				Notification: 15,
			},
			FileType: {
				Unknown: 0,
				File: 1,
				Directory: 2,
				SymbolicLink: 64,
			},
			DiagnosticSeverity: {
				Error: 0,
				Warning: 1,
				Information: 2,
				Hint: 3,
			},
			UIKind: {
				Desktop: 1,
				Web: 2,
			},
		}
	}
}
