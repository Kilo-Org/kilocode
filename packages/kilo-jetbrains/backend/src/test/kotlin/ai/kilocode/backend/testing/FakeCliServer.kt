package ai.kilocode.backend.testing

import ai.kilocode.backend.app.CliServer

/**
 * Fake [CliServer] that delegates to a [MockCliServer] instead of
 * spawning a real CLI process. Returns the mock's port and password
 * from [init], and has no real process to monitor.
 *
 * [stop] shuts down the current server socket (restartable).
 * [dispose] does final cleanup (not restartable).
 */
class FakeCliServer(private val mock: MockCliServer) : CliServer {

    override var forceExtract = false

    override fun process(): Process? = null

    override suspend fun init(): CliServer.State =
        CliServer.State.Ready(mock.start(), mock.password)

    override fun exited(proc: Process) {}

    /** Shutdown the server socket but keep the mock alive for restart. */
    override fun stop() {
        mock.shutdown()
    }

    /** Final cleanup. */
    override fun dispose() {
        mock.close()
    }
}
