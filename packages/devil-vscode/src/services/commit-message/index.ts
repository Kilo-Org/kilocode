import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../cli-backend/connection-service"
import { getErrorMessage } from "../../kilo-provider-utils"

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

function findRepository(repositories: GitRepository[], arg?: vscode.SourceControl): GitRepository | undefined {
  if (!repositories.length) return undefined
  if (arg?.rootUri) {
    const target = arg.rootUri.fsPath
    const match = repositories.find((r) => r.rootUri.fsPath === target)
    if (match) return match
  }
  return repositories[0]
}

export function registerCommitMessageService(
  context: vscode.ExtensionContext,
  connectionService: KiloConnectionService,
): vscode.Disposable[] {
  const command = vscode.commands.registerCommand(
    "kilo-code.new.generateCommitMessage",
    async (arg?: vscode.SourceControl) => {
      const extension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git")
      if (!extension) {
        vscode.window.showErrorMessage("Git extension not found")
        return
      }

      if (!extension.isActive) {
        await extension.activate()
      }

      const git = extension.exports?.getAPI(1)
      const repository = findRepository(git?.repositories ?? [], arg)
      if (!repository) {
        vscode.window.showErrorMessage("No Git repository found")
        return
      }

      let client: KiloClient | undefined
      try {
        client = connectionService.getClient()
      } catch (err) {
        console.error("[Kilo New] Failed to get client:", err)
        vscode.window.showErrorMessage("Kilo backend is not connected. Please wait for the connection to establish.")
        return
      }
      if (!client) {
        vscode.window.showErrorMessage("Kilo backend is not connected. Please wait for the connection to establish.")
        return
      }

      const path = repository.rootUri.fsPath

      const previousMessage = lastWorkspacePath === path ? lastGeneratedMessage : undefined

      const controller = new AbortController()

      await vscode.window
        .withProgress(
          {
            location: vscode.ProgressLocation.SourceControl,
            title: "Generating commit message...",
            cancellable: true,
          },
          async (_progress, token) => {
            // Wire VS Code cancellation to abort the HTTP request
            token.onCancellationRequested(() => controller.abort())

            // Client-side safety timeout (35s) — slightly longer than the
            // server-side 30s timeout so the server can respond with a proper
            // error first, but still ensures the spinner never hangs forever.
            const timeout = 35_000
            const timer = setTimeout(() => controller.abort(), timeout)

            try {
              const { data } = await client.commitMessage.generate(
                { path, selectedFiles: undefined, previousMessage },
                { throwOnError: true, signal: controller.signal },
              )
              const message = data.message
              repository.inputBox.value = message
              lastGeneratedMessage = message
              lastWorkspacePath = path
              console.log("[Kilo New] Commit message generated successfully")
            } finally {
              clearTimeout(timer)
            }
          },
        )
        .then(undefined, (error: unknown) => {
          if (controller.signal.aborted) {
            console.log("[Kilo New] Commit message generation was cancelled or timed out")
            return
          }
          const msg = getErrorMessage(error)
          console.error("[Kilo New] Failed to generate commit message:", msg)
          vscode.window.showErrorMessage(`Failed to generate commit message: ${msg}`)
        })
    },
  )

  context.subscriptions.push(command)
  return [command]
}
