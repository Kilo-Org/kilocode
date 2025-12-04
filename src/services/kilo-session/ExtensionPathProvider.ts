import * as vscode from "vscode"
import * as path from "path"
import { createHash } from "crypto"
import { existsSync, mkdirSync } from "fs"
import type { IPathProvider } from "../../shared/kilocode/cli-sessions/types/IPathProvider"

export class ExtensionPathProvider implements IPathProvider {
	private readonly globalStoragePath: string

	constructor(context: vscode.ExtensionContext) {
		this.globalStoragePath = context.globalStorageUri.fsPath
	}

	getTasksDir(): string {
		return path.join(this.globalStoragePath, "tasks")
	}

	getSessionFilePath(workspaceName: string): string {
		const hash = createHash("sha256").update(workspaceName).digest("hex").substring(0, 16)
		const workspaceDir = path.join(this.globalStoragePath, "sessions", hash)

		if (!existsSync(workspaceDir)) {
			mkdirSync(workspaceDir, { recursive: true })
		}

		return path.join(workspaceDir, "session.json")
	}
}
