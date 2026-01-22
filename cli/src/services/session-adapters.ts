import { KiloCodePaths } from "@kilocode/agent-runtime"
import type { ExtensionService } from "./extension.js"
import type { IPathProvider } from "../../../src/shared/kilocode/cli-sessions/types/IPathProvider"
import type { IExtensionMessenger } from "../../../src/shared/kilocode/cli-sessions/types/IExtensionMessenger"
import type { WebviewMessage } from "../../../src/shared/WebviewMessage"

export class KiloCodePathProvider implements IPathProvider {
	getTasksDir(): string {
		return KiloCodePaths.getTasksDir()
	}

	getSessionFilePath(workspaceDir: string): string {
		return KiloCodePaths.getSessionFilePath(workspaceDir)
	}
}

export class ExtensionMessengerAdapter implements IExtensionMessenger {
	constructor(private extensionService: ExtensionService) {}

	async sendWebviewMessage(message: WebviewMessage): Promise<void> {
		return this.extensionService.sendWebviewMessage(message)
	}

	async requestSingleCompletion(prompt: string, timeoutMs: number): Promise<string> {
		return this.extensionService.requestSingleCompletion(prompt, timeoutMs)
	}
}
