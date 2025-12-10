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
     * Default timeout in milliseconds for inline completion requests.
     * Set to 10 seconds to allow sufficient time for LLM response.
     */
    const val RPC_TIMEOUT_MS = 10000L
}