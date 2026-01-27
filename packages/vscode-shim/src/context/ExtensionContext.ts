import * as path from "path"
import * as fs from "fs"
import { Uri } from "../classes/Uri.js"
import { FileMemento } from "../storage/Memento.js"
import { FileSecretStorage } from "../storage/SecretStorage.js"
import { hashWorkspacePath, ensureDirectoryExists } from "../utils/paths.js"
import type {
	ExtensionContext,
	Extension,
	Disposable,
	Memento,
	SecretStorage,
	ExtensionMode,
	ExtensionKind,
} from "../types.js"

/**
 * Options for creating an ExtensionContext
 */
export interface ExtensionContextOptions {
	/**
	 * Path to the extension's root directory
	 */
	extensionPath: string

	/**
	 * Path to the workspace directory
	 */
	workspacePath: string

	/**
	 * Optional custom storage directory (defaults to ~/.vscode-mock)
	 */
	storageDir?: string

	/**
	 * Extension mode (Production, Development, or Test)
	 */
	extensionMode?: ExtensionMode
}

/**
 * Implementation of VSCode's ExtensionContext
 *
 * Provides the context object passed to extension activation functions.
 * This includes state storage, secrets, and extension metadata.
 *
 * @example
 * ```typescript
 * const context = new ExtensionContextImpl({
 *   extensionPath: '/path/to/extension',
 *   workspacePath: '/path/to/workspace'
 * })
 *
 * // Use in extension activation
 * const api = await extension.activate(context)
 * ```
 */
export class ExtensionContextImpl implements ExtensionContext {
	public subscriptions: Disposable[] = []
	public workspaceState: Memento
	public globalState: Memento & { setKeysForSync(keys: readonly string[]): void }
	public secrets: SecretStorage
	public extensionUri: Uri
	public extensionPath: string
	public environmentVariableCollection: Record<string, unknown> = {}
	public storageUri: Uri | undefined
	public storagePath: string | undefined
	public globalStorageUri: Uri
	public globalStoragePath: string
	public logUri: Uri
	public logPath: string
	public extensionMode: ExtensionMode
	public extension: Extension<unknown> | undefined

	constructor(options: ExtensionContextOptions) {
		this.extensionPath = options.extensionPath
		this.extensionUri = Uri.file(options.extensionPath)
		this.extensionMode = options.extensionMode || 1 // Default to Production

		// Setup storage paths
		const baseStorageDir =
			options.storageDir || path.join(process.env.HOME || process.env.USERPROFILE || ".", ".vscode-mock")
		const workspaceHash = hashWorkspacePath(options.workspacePath)

		this.globalStoragePath = path.join(baseStorageDir, "global-storage")
		this.globalStorageUri = Uri.file(this.globalStoragePath)

		const workspaceStoragePath = path.join(baseStorageDir, "workspace-storage", workspaceHash)
		this.storagePath = workspaceStoragePath
		this.storageUri = Uri.file(workspaceStoragePath)

		this.logPath = path.join(baseStorageDir, "logs")
		this.logUri = Uri.file(this.logPath)

		// Ensure directories exist
		ensureDirectoryExists(this.globalStoragePath)
		ensureDirectoryExists(workspaceStoragePath)
		ensureDirectoryExists(this.logPath)

		// Initialize state storage
		this.workspaceState = new FileMemento(path.join(workspaceStoragePath, "workspace-state.json"))

		const globalMemento = new FileMemento(path.join(this.globalStoragePath, "global-state.json"))
		this.globalState = Object.assign(globalMemento, {
			setKeysForSync: (_keys: readonly string[]) => {
				// No-op for mock implementation
			},
		})

		this.secrets = new FileSecretStorage(this.globalStoragePath)

		// Load extension metadata (packageJSON)
		this.extension = this.loadExtensionMetadata()
	}

	/**
	 * Load extension metadata from package.json
	 */
	private loadExtensionMetadata(): Extension<unknown> | undefined {
		try {
			// Try to load package.json from extension path
			const packageJsonPath = path.join(this.extensionPath, "package.json")
			if (fs.existsSync(packageJsonPath)) {
				const packageJSON = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))
				const extensionId = `${packageJSON.publisher || "unknown"}.${packageJSON.name || "unknown"}`

				return {
					id: extensionId,
					extensionUri: this.extensionUri,
					extensionPath: this.extensionPath,
					isActive: true,
					packageJSON,
					exports: undefined,
					extensionKind: 1 as ExtensionKind, // UI
					activate: () => Promise.resolve(undefined),
				}
			}
		} catch {
			// Ignore errors loading package.json
		}
		return undefined
	}

	/**
	 * Dispose all subscriptions
	 */
	dispose(): void {
		for (const subscription of this.subscriptions) {
			try {
				subscription.dispose()
			} catch (error) {
				console.error("Error disposing subscription:", error)
			}
		}
		this.subscriptions = []
	}
}
