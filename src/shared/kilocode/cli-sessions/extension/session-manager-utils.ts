import type { ClineProvider } from "../../../../core/webview/ClineProvider"
import { ExtensionLoggerAdapter } from "../../../../services/kilo-session/ExtensionLoggerAdapter"
import { ExtensionMessengerImpl } from "../../../../services/kilo-session/ExtensionMessengerImpl"
import { ExtensionPathProvider } from "../../../../services/kilo-session/ExtensionPathProvider"
import { SessionManager } from "../core/SessionManager"
import * as vscode from "vscode"

const kilo_isCli = () => {
	return process.env.KILO_CLI_MODE === "true"
}

export async function kilo_execIfExtension<T extends (...args: any) => any>(cb: T): Promise<ReturnType<T> | void> {
	if (kilo_isCli()) {
		return Promise.resolve()
	}

	return await cb()
}

interface InitializeSessionManagerInput {
	kiloToken: string | undefined
	log: (message: string) => void
	context: vscode.ExtensionContext
	outputChannel: vscode.OutputChannel
	provider: ClineProvider
}

export function kilo_initializeSessionManager({
	kiloToken,
	context,
	log,
	outputChannel,
	provider,
}: InitializeSessionManagerInput) {
	return kilo_execIfExtension(() => {
		try {
			if (!kiloToken) {
				log("SessionManager not initialized: No authentication token available")
				return
			}

			const pathProvider = new ExtensionPathProvider(context)
			const logger = new ExtensionLoggerAdapter(outputChannel)
			const extensionMessenger = new ExtensionMessengerImpl(provider)

			const sessionManager = SessionManager.init({
				pathProvider,
				logger,
				extensionMessenger,
				getToken: () => Promise.resolve(kiloToken),
				onSessionCreated: (message) => {
					log(`Session created: ${message.sessionId}`)
				},
				onSessionRestored: () => {
					log("Session restored")
				},
				platform: vscode.env.appName,
			})

			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
			if (workspaceFolder) {
				sessionManager.setWorkspaceDirectory(workspaceFolder.uri.fsPath)
			}

			log("SessionManager initialized successfully")
		} catch (error) {
			log(`Failed to initialize SessionManager: ${error instanceof Error ? error.message : String(error)}`)
		}
	})
}
