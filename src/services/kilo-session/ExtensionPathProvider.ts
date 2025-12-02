import * as vscode from "vscode"
import * as path from "path"
import { createHash } from "crypto"
import { existsSync, mkdirSync } from "fs"
import type { IPathProvider } from "../../shared/kilocode/cli-sessions/types/IPathProvider"

export class ExtensionPathProvider implements IPathProvider {
	private readonly globalStoragePath: string

	constructor(context: vscode.ExtensionContext) {
		this.globalStoragePath = context.globalStorageUri.fsPath
		this.ensureDirectories()
	}

	private ensureDirectories(): void {
		const sessionsDir = path.join(this.globalStoragePath, "sessions")
		const tasksDir = this.getTasksDir()
		const workspacesDir = path.join(sessionsDir, "workspaces")

		for (const dir of [sessionsDir, tasksDir, workspacesDir]) {
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true })
			}
		}
	}

	getTasksDir(): string {
		return path.join(this.globalStoragePath, "sessions", "tasks")
	}

	getSessionFilePath(workspaceDir: string): string {
		const hash = createHash("sha256").update(workspaceDir).digest("hex").substring(0, 16)
		const workspacesDir = path.join(this.globalStoragePath, "sessions", "workspaces")
		const workspaceSessionDir = path.join(workspacesDir, hash)

		if (!existsSync(workspaceSessionDir)) {
			mkdirSync(workspaceSessionDir, { recursive: true })
		}

		return path.join(workspaceSessionDir, "session.json")
	}
}
