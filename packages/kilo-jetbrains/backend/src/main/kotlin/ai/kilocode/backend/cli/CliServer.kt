package ai.kilocode.backend.cli

/**
 * Abstraction over the CLI process lifecycle.
 *
 * Production: [KiloBackendCliManager]. Tests: fake returning mock server port.
 */
interface CliServer {
    sealed class State {
        data class Ready(val port: Int, val password: String) : State()
        data class Error(val message: String, val details: String? = null) : State()
    }

    var forceExtract: Boolean
    fun process(): Process?
    suspend fun init(onProgress: (CliDownload) -> Unit = {}, onResolved: () -> Unit = {}): State
    fun exited(proc: Process)
    fun stop()
    fun dispose()

    /**
     * Fast teardown for IDE app close. Implementations must not block the caller — it is often the
     * EDT during the IDE shutdown sequence. Defaults to [dispose] for test doubles.
     */
    fun closeForShutdown() = dispose()
}

data class CliDownload(
    val percent: Int,
    val version: String,
    val platform: String,
)
