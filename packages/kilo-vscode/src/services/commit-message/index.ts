import * as vscode from "vscode"
import type { KiloConnectionService } from "../cli-backend/connection-service"
import type { HttpClient } from "../cli-backend/http-client"

let lastGeneratedMessage: string | undefined
let lastWorkspacePath: string | undefined

interface GitRepository {
  inputBox: { value: string }
  rootUri: vscode.Uri
}

interface GitAPI {
  repositories: GitRepository[]
}

interface GitExtensionExports {
  getAPI(version: number): GitAPI
}

export function registerCommitMessageService(
  context: vscode.ExtensionContext,
  connectionService: KiloConnectionService,
): vscode.Disposable[] {
  const command = vscode.commands.registerCommand("kilo-code.new.generateCommitMessage", async () => {
    const extension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git")
    if (!extension) {
      vscode.window.showErrorMessage("Git extension not found")
      return
    }

    if (!extension.isActive) {
      await extension.activate()
    }

    const git = extension.exports?.getAPI(1)
    const repository = git?.repositories[0]
    if (!repository) {
      vscode.window.showErrorMessage("No Git repository found")
      return
    }

    let client: HttpClient | undefined
    try {
      client = connectionService.getHttpClient()
    } catch {
      vscode.window.showErrorMessage("Kilo backend is not connected. Please wait for the connection to establish.")
      return
    }
    if (!client) {
      vscode.window.showErrorMessage("Kilo backend is not connected. Please wait for the connection to establish.")
      return
    }

    const path = repository.rootUri.fsPath

    const previousMessage = lastWorkspacePath === path ? lastGeneratedMessage : undefined

    await vscode.window
      .withProgress(
        { location: vscode.ProgressLocation.SourceControl, title: "Generating commit message..." },
        async () => {
          const message = await client.generateCommitMessage(path, undefined, previousMessage)
          repository.inputBox.value = message
          lastGeneratedMessage = message
          lastWorkspacePath = path
          console.log("[Kilo New] Commit message generated successfully")
        },
      )
      .then(undefined, (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error)
        console.error("[Kilo New] Failed to generate commit message:", msg)
        vscode.window.showErrorMessage(`Failed to generate commit message: ${msg}`)
      })
  })

  context.subscriptions.push(command)
  return [command]
}
