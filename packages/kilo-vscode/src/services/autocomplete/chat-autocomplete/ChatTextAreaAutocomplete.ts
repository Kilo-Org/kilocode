import { AutocompleteModel } from "../AutocompleteModel"
import { AutocompleteContext, VisibleCodeContext } from "../types"
import { removePrefixOverlap } from "../continuedev/core/autocomplete/postprocessing/removePrefixOverlap.js"
import { AutocompleteTelemetry } from "../classic-auto-complete/AutocompleteTelemetry"
import { postprocessAutocompleteSuggestion } from "../classic-auto-complete/uselessSuggestionFilter"
import type { KiloConnectionService } from "../../cli-backend"
import { finalizeChatSuggestion, buildChatPrefix } from "./chat-autocomplete-utils"

export class ChatTextAreaAutocomplete {
  private model: AutocompleteModel
  private telemetry: AutocompleteTelemetry

  constructor(connectionService: KiloConnectionService) {
    this.model = new AutocompleteModel(connectionService)
    this.telemetry = new AutocompleteTelemetry("chat-textarea")
  }

  async initialize(): Promise<boolean> {
    return this.model.reload()
  }

  async getCompletion(userText: string, visibleCodeContext?: VisibleCodeContext): Promise<{ suggestion: string }> {
    const startTime = Date.now()

    // Build context for telemetry
    const context: AutocompleteContext = {
      languageId: "chat", // Chat textarea doesn't have a language ID
      modelId: this.model.getModelName(),
      provider: this.model.getProviderDisplayName(),
    }

    if (!this.model.loaded) {
      const loaded = await this.initialize()
      if (!loaded) {
        return { suggestion: "" }
      }
    }

    // Check if model has valid credentials (but don't require FIM)
    if (!this.model.hasValidCredentials()) {
      return { suggestion: "" }
    }

    // Capture suggestion requested
    this.telemetry.captureSuggestionRequested(context)

    const prefix = await this.buildPrefix(userText, visibleCodeContext)
    const suffix = ""

    let response = ""

    try {
      // Use FIM if supported, otherwise fall back to chat-based completion
      if (this.model.supportsFim()) {
        await this.model.generateFimResponse(prefix, suffix, (chunk) => {
          response += chunk
        })
      } else {
        // Fall back to chat-based completion for models without FIM support
        const systemPrompt = this.getChatSystemPrompt()
        const userPrompt = this.getChatUserPrompt(prefix)

        await this.model.generateResponse(systemPrompt, userPrompt, (chunk) => {
          if (chunk.type === "text") {
            response += chunk.text
          }
        })
      }

      const latencyMs = Date.now() - startTime

      // Capture successful LLM request
      this.telemetry.captureLlmRequestCompleted(
        {
          latencyMs,
          // Token counts not available from current API
        },
        context,
      )

      const cleanedSuggestion = this.cleanSuggestion(response, userText)

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

  /**
   * Get system prompt for chat-based completion
   */
  private getChatSystemPrompt(): string {
    return `You are an intelligent chat completion assistant. Your task is to complete the user's message naturally based on the provided context.

## RULES
- Provide a natural, conversational completion
- Be concise - typically 1-15 words
- Match the user's tone and style
- Use context from visible code if relevant
- NEVER repeat what the user already typed
- NEVER start with comments (//, /*, #)
- If the user is in the middle of typing a word (e.g., "hel"), include the COMPLETE word in your response (e.g., "hello world" not just "lo world")
- This allows proper prefix matching to remove the overlap correctly
- Return ONLY the completion text, no explanations or formatting`
  }

  /**
   * Get user prompt for chat-based completion
   */
  private getChatUserPrompt(prefix: string): string {
    return `${prefix}

TASK: Complete the user's message naturally. 
- If the user is mid-word (e.g., typed "hel"), return the COMPLETE word (e.g., "hello world") so prefix matching can work correctly
- Return ONLY the completion text (what comes next), no explanations.`
  }

  private async buildPrefix(userText: string, visibleCodeContext?: VisibleCodeContext): Promise<string> {
    return buildChatPrefix(userText, visibleCodeContext?.editors)
  }

  public cleanSuggestion(suggestion: string, userText: string): string {
    const cleaned = postprocessAutocompleteSuggestion({
      suggestion: removePrefixOverlap(suggestion, userText),
      prefix: userText,
      suffix: "",
      model: this.model.getModelName() ?? "unknown",
    })
    if (cleaned === undefined) return ""
    return finalizeChatSuggestion(cleaned)
  }
}
