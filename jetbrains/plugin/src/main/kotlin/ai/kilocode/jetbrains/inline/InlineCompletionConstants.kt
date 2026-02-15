package ai.kilocode.jetbrains.inline

/**
 * Shared constants for inline completion functionality.
 */
object InlineCompletionConstants {
    /**
     * VSCode extension command ID for inline completion generation.
     */
    const val EXTERNAL_COMMAND_ID = "kilo-code.jetbrains.getInlineCompletions"

    /**
     * Command ID registered in the VSCode extension for tracking acceptance events.
     * This matches the command registered in AutocompleteInlineCompletionProvider.
     */
    const val INLINE_COMPLETION_ACCEPTED_COMMAND = "kilocode.autocomplete.inline-completion.accepted"

    /**
     * Default timeout in milliseconds for inline completion requests.
     * Set to 10 seconds to allow sufficient time for LLM response.
     */
    const val RPC_TIMEOUT_MS = 10000L
}
