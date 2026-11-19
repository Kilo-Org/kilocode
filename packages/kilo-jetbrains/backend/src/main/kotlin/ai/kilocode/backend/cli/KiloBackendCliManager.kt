package ai.kilocode.backend.cli

import ai.kilocode.backend.dev.KiloDevMode
import ai.kilocode.backend.v2.V2Client
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.components.Service
import com.intellij.util.EnvironmentUtil
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.runInterruptible
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

sealed interface CliState {
    data object Stopped : CliState
    data class Starting(val percent: Int? = null) : CliState
    data object Ready : CliState
    data class Failed(val message: String) : CliState
}

/** Application-level backend service: split clients receive RPC data, never a loopback URL or password. */
@Service
class KiloBackendCliManager(scope: CoroutineScope) : Disposable {
    private val storage = Path.of(PathManager.getSystemPath(), "kilo2")
    private val cwd = storage.resolve("cwd")
    private val downloader by lazy { KiloCliDownloader(storage.resolve("cli")) }
    private val runtime = CliRuntime(scope, cwd, environment = {
        val info = ApplicationInfo.getInstance()
        cliEnvironment(EnvironmentUtil.getEnvironmentMap(), cwd, "${info.fullApplicationName} ${info.build.asString()}",
            KiloClaudeCompatSettings.get())
    }, resolve = { env, force, progress ->
        KiloDevMode.command(System.getProperty("kilo.dev.worktree.root"), storage, env) ?: run {
            val pin = KiloProps.pin
            CliCommand(listOf(downloader.resolve(pin, env, force, progress).toString()), expectedVersion = pin.version)
        }
    })

    val state: StateFlow<CliState> get() = runtime.state
    val version: String get() = KiloProps.pin.version
    val platform: String get() = KiloProps.pin.platform
    val bundled: Boolean get() = System.getProperty("kilo.dev.worktree.root") == null && KiloProps.pin.bundled != null

    suspend fun client(): V2Client = runtime.get()
    suspend fun restart(force: Boolean = false): V2Client = runtime.get(restart = true, force = force)
    fun shutdown(fast: Boolean) = runtime.shutdown(fast)
    override fun dispose() = shutdown(fast = true)
}

internal class CliRuntime(
    private val scope: CoroutineScope,
    private val cwd: Path,
    private val environment: () -> Map<String, String>,
    private val resolve: suspend (Map<String, String>, Boolean, (Int) -> Unit) -> CliCommand,
    private val timeoutMs: Long = 60_000,
) {
    private class Attempt {
        lateinit var result: Deferred<Result<V2Client>>
        var server: CliServer? = null
        var client: V2Client? = null
        var retryAt = 0L
    }

    private val status = MutableStateFlow<CliState>(CliState.Stopped)
    val state = status.asStateFlow()
    private var current: Attempt? = null
    private var stopping: CompletableFuture<Void>? = null
    private var closed = false

    suspend fun get(restart: Boolean = false, force: Boolean = false) = start(restart, force).await().getOrThrow()

    @Synchronized private fun start(restart: Boolean, force: Boolean): Deferred<Result<V2Client>> {
        check(!closed) { "Kilo CLI service is closed" }
        current?.let {
            if (!restart && (it.retryAt == 0L || System.nanoTime() < it.retryAt)) return it.result
        }
        val stopped = detach(fast = false)
        val attempt = Attempt()
        current = attempt
        status.value = CliState.Starting()
        // Startup is owned by the service scope: cancelling a frontend RPC must not cancel other callers' server.
        attempt.result = scope.async(Dispatchers.IO, start = CoroutineStart.LAZY) {
            try {
                stopped?.let { runInterruptible { it.get() } }
                val env = environment()
                val cmd = resolve(env, force) { percent -> synchronized(this@CliRuntime) {
                    if (current === attempt) status.value = CliState.Starting(percent)
                } }
                currentCoroutineContext().ensureActive()
                val server = synchronized(this@CliRuntime) {
                    check(current === attempt) { "CLI start was superseded" }
                    CliServer.start(cmd, cwd, env).also { attempt.server = it }
                }
                server.onExit { code -> exited(attempt, code) }
                val client = server.identify(timeoutMs)
                synchronized(this@CliRuntime) {
                    if (current !== attempt || !server.alive) {
                        client.close()
                        error("CLI exited during startup")
                    }
                    attempt.client = client
                    status.value = CliState.Ready
                }
                Result.success(client)
            } catch (e: CancellationException) {
                synchronized(this@CliRuntime) { attempt.server?.stop() }
                throw e
            } catch (e: Exception) {
                synchronized(this@CliRuntime) {
                    attempt.server?.stop()
                    if (current === attempt) {
                        attempt.retryAt = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
                        status.value = CliState.Failed(e.message ?: "Kilo CLI startup failed")
                    }
                }
                Result.failure(e)
            }
        }
        attempt.result.start()
        return attempt.result
    }

    @Synchronized private fun exited(attempt: Attempt, code: Int) {
        if (current !== attempt || status.value != CliState.Ready) return
        current = null
        attempt.client?.close()
        status.value = CliState.Failed("Kilo CLI exited (code $code)")
    }

    fun shutdown(fast: Boolean) {
        val stopped = synchronized(this) {
            closed = true
            status.value = CliState.Stopped
            detach(fast)
        }
        // The plugin unload listener must release file handles before an update replaces the plugin.
        // IDE shutdown merely closes the lease and must never block the shutdown thread.
        if (!fast) stopped?.get(10, TimeUnit.SECONDS)
    }

    private fun detach(fast: Boolean): CompletableFuture<Void>? {
        val old = current ?: return stopping
        current = null
        old.result.cancel()
        old.client?.close()
        old.server?.let { stopping = it.stop(fast) }
        return stopping
    }
}
