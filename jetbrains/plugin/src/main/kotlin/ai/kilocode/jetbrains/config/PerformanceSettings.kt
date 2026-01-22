package ai.kilocode.jetbrains.config

/**
 * Configurable performance settings for event debouncing and concurrency control.
 * These settings allow tuning the balance between responsiveness and resource usage.
 */
object PerformanceSettings {
    /**
     * Debounce delay for file system events in milliseconds.
     * Higher values reduce processing load but may delay file sync.
     * Default: 50ms
     */
    var fileEventDebounceMs: Long = 50

    /**
     * Debounce delay for editor activation events in milliseconds.
     * Higher values reduce processing load during rapid editor switching.
     * Default: 100ms
     */
    var editorActivationDebounceMs: Long = 100

    /**
     * Debounce delay for editor edit events in milliseconds.
     * Higher values reduce processing load during typing but may delay updates.
     * Default: 50ms
     */
    var editorEditDebounceMs: Long = 50

    /**
     * Maximum number of concurrent RPC calls allowed.
     * This prevents resource exhaustion from too many simultaneous operations.
     * Default: 100
     */
    var maxConcurrentRpcCalls: Int = 100
}
