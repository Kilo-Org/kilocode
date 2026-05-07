import * as vscode from "vscode"
import type { AutocompleteContext, VisibleCodeContext } from "../types"
import { removePrefixOverlap } from "../continuedev/core/autocomplete/postprocessing/removePrefixOverlap.js"
import { AutocompleteTelemetry } from "../classic-auto-complete/AutocompleteTelemetry"
import { postprocessAutocompleteSuggestion } from "../classic-auto-complete/uselessSuggestionFilter"
import { VisibleCodeTracker } from "../context/VisibleCodeTracker"
import { FileIgnoreController } from "../shims/FileIgnoreController"
import type { KiloConnectionService } from "../../cli-backend"
import { generateFim, hasValidCredentials } from "../fim"
import { getAutocompleteModel } from "../../../shared/autocomplete-models"
import { finalizeChatSuggestion, buildChatPrefix } from "./chat-autocomplete-utils"

interface ChatCompletionRequestMessage {
  type: "requestChatCompletion"
  text: string
  requestId: string
}

interface ChatCompletionResponseSender {
  postMessage(message: { type: "chatCompletionResult"; text: string; requestId: string }): void
}

/**
 * Chat textarea autocomplete with cached per-request objects.
 *
 * Caches FileIgnoreController (refreshed when workspace changes or when
 * .kilocodeignore / .gitignore files are modified) and shares a single
 * AutocompleteTelemetry instance across requests so that request and
 * acceptance events correlate.
 */
export class ChatTextAreaAutocomplete {
  private connection: KiloConnectionService
  readonly telemetry: AutocompleteTelemetry
  private ignore: FileIgnoreController | null = null
  private dir = ""
  private watcher: vscode.FileSystemWatcher | undefined

  constructor(connectionService: KiloConnectionService, telemetry?: AutocompleteTelemetry) {
    this.connection = connectionService
    this.telemetry = telemetry ?? new AutocompleteTelemetry("chat-textarea")
    this.watcher = vscode.workspace.createFileSystemWatcher("**/{.kilocodeignore,.gitignore}")
    const invalidate = () => {
      // Don't dispose — an in-flight request may still hold a reference.
      // The old instance will be garbage collected once no longer referenced.
      this.ignore = null
    }
    this.watcher.onDidChange(invalidate)
    this.watcher.onDidCreate(invalidate)
    this.watcher.onDidDelete(invalidate)
  }

  /**
   * Full request handler — resolves visible code context, generates a
   * completion, and posts the result back to the webview.
   */
  async handle(message: ChatCompletionRequestMessage, sender: ChatCompletionResponseSender): Promise<void> {
    const { text, requestId } = message
    if (!text || !requestId) return

    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ""

    // Re-initialize the ignore controller only when the workspace changes
    if (!this.ignore || this.dir !== workspace) {
      this.ignore?.dispose()
      this.ignore = new FileIgnoreController(workspace)
      await this.ignore.initialize()
      this.dir = workspace
    }

    const tracker = new VisibleCodeTracker(workspace, this.ignore)
    const context = await tracker.captureVisibleCode()

    const { suggestion } = await this.getCompletion(text, context)

    sender.postMessage({ type: "chatCompletionResult", text: suggestion, requestId })
  }

  async getCompletion(userText: string, visibleCodeContext?: VisibleCodeContext): Promise<{ suggestion: string }> {
    const cfg = vscode.workspace.getConfiguration("kilo-code.new.autocomplete")
    const entry = getAutocompleteModel(cfg.get<string>("model") ?? "")
    const startTime = Date.now()

    // Build context for telemetry
    const context: AutocompleteContext = {
      languageId: "chat", // Chat textarea doesn't have a language ID
      modelId: entry.id,
      provider: entry.provider,
    }

    // Check for valid credentials (but don't require FIM)
    if (!hasValidCredentials(this.connection)) {
      return { suggestion: "" }
    }

    // Capture suggestion requested
    this.telemetry.captureSuggestionRequested(context)

    const prefix = await this.buildPrefix(userText, visibleCodeContext)
    const suffix = ""

    let response = ""

    try {
      await generateFim(this.connection, entry.id, prefix, suffix, (chunk) => {
        response += chunk
      })

      const latencyMs = Date.now() - startTime

      // Capture successful LLM request
      this.telemetry.captureLlmRequestCompleted(
        {
          latencyMs,
          // Token counts not available from current API
        },
        context,
      )

      const cleanedSuggestion = this.cleanSuggestion(response, userText, entry.id)

      // Track if suggestion was filtered or returned
      if (!cleanedSuggestion) {
        if (!response.trim()) {
          this.telemetry.captureSuggestionFiltered("empty_response", context)
        } else {
          this.telemetry.captureSuggestionFiltered("filtered_by_postprocessing", context)
        }
      } else {
        this.telemetry.captureLlmSuggestionReturned(context, cleanedSuggestion.length)
      }

      return { suggestion: cleanedSuggestion }
    } catch (error) {
      const latencyMs = Date.now() - startTime
      this.telemetry.captureLlmRequestFailed(
        {
          latencyMs,
          error: error instanceof Error ? error.message : String(error),
        },
        context,
      )
      return { suggestion: "" }
    }
  }

  private async buildPrefix(userText: string, visibleCodeContext?: VisibleCodeContext): Promise<string> {
    return buildChatPrefix(userText, visibleCodeContext?.editors)
  }

  public cleanSuggestion(suggestion: string, userText: string, modelId: string): string {
    const cleaned = postprocessAutocompleteSuggestion({
      suggestion: removePrefixOverlap(suggestion, userText),
      prefix: userText,
      suffix: "",
      model: modelId || "unknown",
    })
    if (cleaned === undefined) return ""
    return finalizeChatSuggestion(cleaned)
  }

  dispose() {
    this.watcher?.dispose()
    this.ignore?.dispose()
    this.ignore = null
  }
}
