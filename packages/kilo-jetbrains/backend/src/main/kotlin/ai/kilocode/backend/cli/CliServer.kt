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
    suspend fun init(): State
    fun exited(proc: Process)
    fun stop()
    fun dispose()
}
