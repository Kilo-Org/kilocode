package ai.kilocode.jetbrains.core

import com.intellij.openapi.diagnostic.Logger

/**
 * Health check mechanism for initialization process.
 * Monitors initialization progress and provides recovery suggestions.
 */
class InitializationHealthCheck(private val stateMachine: InitializationStateMachine) {
    private val logger = Logger.getInstance(InitializationHealthCheck::class.java)

    enum class HealthStatus {
        HEALTHY,
        STUCK,
        FAILED
    }

    /**
     * Check the health of the initialization process.
     * @return Current health status
     */
    fun checkHealth(): HealthStatus {
        val currentState = stateMachine.getCurrentState()
        val stateAge = stateMachine.getStateDuration(currentState) ?: 0L

        return when {
            currentState == InitializationState.FAILED -> HealthStatus.FAILED
            stateAge > getMaxDuration(currentState) -> HealthStatus.STUCK
            else -> HealthStatus.HEALTHY
        }
    }

    /**
     * Get suggestions for the current health status.
     * @return List of suggestions for the user
     */
    fun getSuggestions(): List<String> {
        val status = checkHealth()
        val currentState = stateMachine.getCurrentState()

        return when (status) {
            HealthStatus.STUCK -> getSuggestionsForStuckState(currentState)
            HealthStatus.FAILED -> listOf("Initialization failed. Please check logs and restart the IDE.")
            else -> emptyList()
        }
    }

    /**
     * Get maximum allowed duration for a state before it's considered stuck.
     * This is typically 3-5x the expected duration to account for slow machines.
     * @param state The state to check
     * @return Maximum duration in milliseconds
     */
    private fun getMaxDuration(state: InitializationState): Long {
        return when (state) {
            InitializationState.SOCKET_CONNECTING -> 20000L // 20 seconds
            InitializationState.SOCKET_CONNECTED -> 5000L
            InitializationState.READY_RECEIVED -> 5000L
            InitializationState.INIT_DATA_SENT -> 10000L
            InitializationState.INITIALIZED_RECEIVED -> 10000L
            InitializationState.RPC_CREATING -> 5000L
            InitializationState.RPC_CREATED -> 5000L
            InitializationState.EXTENSION_ACTIVATING -> 20000L // 20 seconds
            InitializationState.EXTENSION_ACTIVATED -> 15000L // 15 seconds
            InitializationState.WEBVIEW_REGISTERING -> 5000L
            InitializationState.WEBVIEW_REGISTERED -> 3000L
            InitializationState.WEBVIEW_RESOLVING -> 5000L
            InitializationState.WEBVIEW_RESOLVED -> 10000L
            InitializationState.HTML_LOADING -> 30000L // 30 seconds
            InitializationState.HTML_LOADED -> 5000L
            InitializationState.THEME_INJECTING -> 25000L // 25 seconds (10 retries with backoff)
            InitializationState.THEME_INJECTED -> 3000L
            else -> 5000L
        }
    }

    /**
     * Get suggestions for a stuck state.
     * @param state The state that is stuck
     * @return List of suggestions
     */
    private fun getSuggestionsForStuckState(state: InitializationState): List<String> {
        return when (state) {
            InitializationState.SOCKET_CONNECTING -> listOf(
                "Socket connection is taking longer than expected.",
                "Check if Node.js is installed and accessible.",
                "Check firewall settings.",
                "Try restarting the IDE."
            )
            InitializationState.EXTENSION_ACTIVATING -> listOf(
                "Extension activation is taking longer than expected.",
                "This might be due to slow disk I/O or CPU.",
                "Try closing other applications to free up resources.",
                "Check if antivirus software is scanning the plugin files."
            )
            InitializationState.HTML_LOADING -> listOf(
                "HTML loading is taking longer than expected.",
                "This might be due to slow disk I/O.",
                "Try closing other applications to free up resources.",
                "Check if antivirus software is interfering."
            )
            InitializationState.THEME_INJECTING -> listOf(
                "Theme injection is taking longer than expected.",
                "This might be due to slow JCEF initialization.",
                "The webview should still work without theme.",
                "Try restarting the IDE if the issue persists."
            )
            InitializationState.WEBVIEW_REGISTERING,
            InitializationState.WEBVIEW_RESOLVING -> listOf(
                "WebView registration is taking longer than expected.",
                "This might be due to slow JCEF initialization.",
                "Try closing other applications to free up resources."
            )
            else -> listOf(
                "Initialization is taking longer than expected. Please wait...",
                "If the issue persists, try restarting the IDE."
            )
        }
    }

    /**
     * Get a diagnostic report including health status and suggestions.
     * @return Diagnostic report as a string
     */
    fun getDiagnosticReport(): String {
        val status = checkHealth()
        val suggestions = getSuggestions()
        val currentState = stateMachine.getCurrentState()
        val stateAge = stateMachine.getStateDuration(currentState) ?: 0L

        return buildString {
            appendLine("=== Initialization Health Check ===")
            appendLine("Status: $status")
            appendLine("Current State: $currentState")
            appendLine("State Age: ${stateAge}ms")
            appendLine()
            if (suggestions.isNotEmpty()) {
                appendLine("Suggestions:")
                suggestions.forEach { suggestion ->
                    appendLine("  - $suggestion")
                }
            }
        }
    }
}
