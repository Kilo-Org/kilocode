import * as vscode from "vscode"
import { VisibleCodeTracker } from "../context/VisibleCodeTracker"
import { FileIgnoreController } from "../shims/FileIgnoreController"
import { ChatTextAreaAutocomplete } from "./ChatTextAreaAutocomplete"
import type { KiloConnectionService } from "../../cli-backend"

export interface ChatCompletionRequestMessage {
  type: "requestChatCompletion"
  text?: string
  requestId?: string
}

export interface ChatCompletionResponseSender {
  postMessage(message: { type: "chatCompletionResult"; text: string; requestId: string }): void
}

/**
 * Handles a chat completion request from the webview.
 * Captures visible code context and generates an autocomplete suggestion.
 */
export async function handleChatCompletionRequest(
  message: ChatCompletionRequestMessage,
  responseSender: ChatCompletionResponseSender,
  connectionService: KiloConnectionService,
): Promise<void> {
  const userText = message.text || ""
  const requestId = message.requestId || ""

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ""

  const ignoreController = new FileIgnoreController(workspacePath)
  await ignoreController.initialize()

  const tracker = new VisibleCodeTracker(workspacePath, ignoreController)
  const visibleContext = await tracker.captureVisibleCode()

  const autocomplete = new ChatTextAreaAutocomplete(connectionService)
  const { suggestion } = await autocomplete.getCompletion(userText, visibleContext)

  responseSender.postMessage({ type: "chatCompletionResult", text: suggestion, requestId })

  ignoreController.dispose()
}
