import {
  AutocompleteInput,
  AutocompleteContextProvider,
  FimAutocompletePrompt,
  FimCompletionResult,
  FillInAtCursorSuggestion,
} from "../types"
import { getProcessedSnippets } from "./getProcessedSnippets"
import { getTemplateForModel } from "../continuedev/core/autocomplete/templating/AutocompleteTemplate"
import { generateFim } from "../fim"
import type { KiloConnectionService } from "../../cli-backend"

export type { FimAutocompletePrompt, FimCompletionResult }

export class FimPromptBuilder {
  constructor(private contextProvider: AutocompleteContextProvider) {}

  /**
   * Build complete FIM prompt with all necessary data
   */
  async getFimPrompts(autocompleteInput: AutocompleteInput, modelName: string): Promise<FimAutocompletePrompt> {
    const { filepathUri, helper, snippetsWithUris, workspaceDirs } = await getProcessedSnippets(
      autocompleteInput,
      autocompleteInput.filepath,
      this.contextProvider.contextService,
      this.contextProvider.modelId,
      this.contextProvider.ide,
      this.contextProvider.ignoreController,
    )

    // Use pruned prefix/suffix from HelperVars (token-limited based on DEFAULT_AUTOCOMPLETE_OPTS)
    const prunedPrefixRaw = helper.prunedPrefix
    const prunedSuffix = helper.prunedSuffix

    const template = getTemplateForModel(modelName)

    let formattedPrefix = prunedPrefixRaw
    if (template.compilePrefixSuffix && prunedSuffix) {
      const [compiledPrefix] = template.compilePrefixSuffix(
        prunedPrefixRaw,
        prunedSuffix,
        filepathUri,
        "", // reponame not used in our context
        snippetsWithUris,
        workspaceDirs,
      )
      formattedPrefix = compiledPrefix
    }

    return {
      formattedPrefix,
      prunedSuffix,
      autocompleteInput,
    }
  }

  /**
   * Execute FIM-based completion using the model
   */
  async getFromFIM(
    connection: KiloConnectionService,
    modelId: string,
    prompt: FimAutocompletePrompt,
    processSuggestion: (text: string) => FillInAtCursorSuggestion,
    signal?: AbortSignal,
  ): Promise<FimCompletionResult> {
    const { formattedPrefix, prunedSuffix, autocompleteInput } = prompt
    let response = ""
    const onChunk = (text: string) => {
      response += text
    }
    const usageInfo = await generateFim(connection, modelId, formattedPrefix, prunedSuffix, onChunk, signal)

    const fillInAtCursorSuggestion = processSuggestion(response)

    return {
      suggestion: fillInAtCursorSuggestion,
      cost: usageInfo.cost,
      inputTokens: usageInfo.inputTokens,
      outputTokens: usageInfo.outputTokens,
      cacheWriteTokens: usageInfo.cacheWriteTokens,
      cacheReadTokens: usageInfo.cacheReadTokens,
    }
  }
}
