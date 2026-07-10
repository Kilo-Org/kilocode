package ai.kilocode.backend.cli

import ai.kilocode.KiloPlugin
import ai.kilocode.backend.dev.KiloDevMode
import ai.kilocode.log.KiloLog
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.util.SystemInfo
import com.intellij.util.EnvironmentUtil
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.io.BufferedReader
import java.io.File
import java.io.InputStream
import java.io.InputStreamReader
import java.nio.file.Files
import java.nio.file.Path
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

private val PORT_REGEX = Regex("""listening on http://[\w.]+:(\d+)""")

/**
 * Manages the Kilo CLI binary lifecycle.
 *
 * Downloads the pinned CLI into IntelliJ's system directory,
 * spawns `kilo serve --port 0`, and exposes the result as [State].
 *
 * Concurrency is handled by the owning [KiloBackendAppService] — all public
 * methods except [exited] are called under its mutex. [exited] is called from
 * [KiloConnectionService]'s IO dispatcher and is thread-safe via the stale-ref
 * guard and volatile [process] field.
 */
class KiloBackendCliManager(
    private val log: KiloLog = KiloLog.create(KiloBackendCliManager::class.java),
    private val timeoutMs: Long = STARTUP_TIMEOUT_MS,
) : CliServer {

    companion object {
        private const val STARTUP_TIMEOUT_MS = 30_000L
        private const val STARTUP_TIMEOUT_GRACE_MS = 8_000L
        private const val KILL_TIMEOUT_SECONDS = 5L
    }

    @Volatile
    private var process: Process? = null
    @Volatile
    private var closing: Process? = null
    private var hook: Thread? = null
    private var stderr: Thread? = null
    private var stdout: Thread? = null

    @Volatile
    override var forceExtract = false

    override fun process(): Process? = process

    override suspend fun init(onProgress: (CliDownload) -> Unit, onResolved: () -> Unit): CliServer.State {
        return try {
            val start = System.nanoTime()
            withTimeout(timeoutMs + STARTUP_TIMEOUT_GRACE_MS) {
                val path = resolveCli(onProgress)
                onResolved()
                log.info("CLI binary path: ${path.absolutePath} (size=${path.length()} bytes)")
                spawn(path, start)
            }
        } catch (e: TimeoutCancellationException) {
            val msg = "CLI startup timed out after ${timeoutMs}ms"
            log.warn(msg, e)
            process?.let { proc ->
                log.info("Cleaning up orphaned CLI process (pid=${proc.pid()})")
                process = null
                cleanup(proc, "startup timeout cleanup")
            }
            CliServer.State.Error(
                message = msg,
                details = e.stackTraceToString(),
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            log.warn("CLI startup failed", e)
            process?.let { proc ->
                log.info("Cleaning up orphaned CLI process (pid=${proc.pid()})")
                process = null
                cleanup(proc, "startup failure cleanup")
            }
            CliServer.State.Error(
                message = e.message ?: "Unknown error",
                details = e.stackTraceToString(),
            )
        }
    }

    override fun exited(proc: Process) {
        if (process != proc) return
        process = null
        uninstall()
        stderr = null
    }

    override fun stop() {
        val proc = process ?: return
        process = null
        cleanup(proc, "stop()")
    }

    private suspend fun resolveCli(onProgress: (CliDownload) -> Unit): File {
        val force = forceExtract
        forceExtract = false
        if (!KiloProps.pinned()) {
            if (force) log.info("Force re-extracting local repo CLI ${KiloProps.cliVersion()}")
            val cli = KiloRepoCli.extract(force)
            onProgress(CliDownload(100, KiloProps.cliVersion(), KiloCliPlatform.current()))
            return cli
        }
        if (force) log.info("Force re-downloading CLI ${KiloProps.cliVersion()}")
        return KiloCliDownloader(log = log).resolve(KiloProps.cliVersion(), force, onProgress)
    }

    // Must be called from a background thread — devStorageEnv() performs blocking I/O (mkdirs).
    internal fun buildEnv(pwd: String, base: Map<String, String> = EnvironmentUtil.getEnvironmentMap()): Map<String, String> =
        buildKiloCliEnv(pwd, base, log)

    private suspend fun spawn(cli: File, start: Long): CliServer.State =
        withContext(Dispatchers.IO) {
            val pwd = generatePassword()

            val env = buildEnv(pwd)
            val diag = startupDiagnostics(cli, env, log)

            val cmd = listOf(cli.absolutePath, "serve", "--port", "0")
            val builder = ProcessBuilder(cmd)
            builder.environment().clear()
            builder.environment().putAll(env)
            builder.redirectErrorStream(false)

            log.info("Starting CLI: ${cmd.joinToString(" ")}")
            log.info("CLI env: KILO_CLIENT=jetbrains KILO_PLATFORM=jetbrains KILO_APP_NAME=kilo-code")
            val proc = try {
                builder.start()
            } catch (e: Exception) {
                log.warn("CLI process failed to start: ${e.message}", e)
                throw e
            }
            log.info("CLI process started (pid=${proc.pid()})")
            process = proc
            install(proc)

            val stderr = StringBuilder()

            val err = Thread({
                runCatching {
                    BufferedReader(InputStreamReader(proc.errorStream)).use { reader ->
                        reader.lineSequence().forEach { line ->
                            log.warn("CLI stderr: $line")
                            synchronized(stderr) { stderr.appendLine(line) }
                        }
                    }
                }.onFailure { err ->
                    if (proc.isAlive && closing !== proc) log.warn("CLI stderr reader failed", err)
                }
            }, "kilo-cli-stderr").apply { isDaemon = true; start() }
            this@KiloBackendCliManager.stderr = err

            val state = awaitReady(
                stdout = proc.inputStream,
                stderr = stderr,
                pwd = pwd,
                timeoutMs = (timeoutMs - elapsed(start)).coerceAtLeast(1L),
                alive = { proc.isAlive },
                pid = { proc.pid() },
                code = { proc.waitFor() },
                onTimeout = {
                    if (process == proc) process = null
                    cleanup(proc, "startup timeout")
                },
                diagnostics = { diag },
                log = log,
                onThread = { stdout = it },
            )
            if (state is CliServer.State.Error && process == proc) {
                process = null
                cleanup(proc, "startup error")
            }
            state
        }

    override fun dispose() {
        val proc = process ?: return
        process = null
        cleanup(proc, "Disposing")
    }

    private fun cleanup(proc: Process, source: String) {
        closing = proc
        try {
            uninstall()
            close(proc)
            kill(proc, source)
            val thread = stderr
            stderr = null
            val out = stdout
            stdout = null
            if (thread != null && thread != Thread.currentThread()) {
                thread.join(TimeUnit.SECONDS.toMillis(1))
            }
            if (out != null && out != Thread.currentThread()) {
                out.join(TimeUnit.SECONDS.toMillis(1))
            }
        } finally {
            closing = null
        }
    }

    private fun install(proc: Process) {
        uninstall()
        val next = Thread({
            log.info("Shutdown hook — killing CLI process tree (pid ${proc.pid()})")
            kill(proc, "Shutdown hook", wait = false)
        }, "kilo-cli-shutdown")
        val ok = runCatching { Runtime.getRuntime().addShutdownHook(next) }
        if (ok.isFailure) {
            log.warn("Failed to install CLI shutdown hook", ok.exceptionOrNull())
            return
        }
        hook = next
    }

    private fun uninstall() {
        val curr = hook ?: return
        hook = null
        val ok = runCatching { Runtime.getRuntime().removeShutdownHook(curr) }
        if (ok.isFailure) {
            log.info("Skipping CLI shutdown hook removal: ${ok.exceptionOrNull()?.message}")
        }
    }

    private fun kill(proc: Process, source: String, wait: Boolean = true) {
        log.info("$source — killing CLI process tree (pid ${proc.pid()})")
        children(proc).forEach { it.destroy() }
        proc.destroy()
        if (!wait) return
        if (!proc.waitFor(KILL_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            log.warn("CLI process did not exit after SIGTERM, sending SIGKILL")
            children(proc).forEach { it.destroyForcibly() }
            proc.destroyForcibly()
        }
    }

    private fun children(proc: Process): List<ProcessHandle> =
        proc.toHandle().descendants().toList().asReversed()

    private fun close(proc: Process) {
        runCatching { proc.errorStream.close() }.onFailure { log.info("CLI stderr stream close skipped: ${it.message}") }
        runCatching { proc.inputStream.close() }.onFailure { log.info("CLI stdout stream close skipped: ${it.message}") }
        runCatching { proc.outputStream.close() }.onFailure { log.info("CLI stdin stream close skipped: ${it.message}") }
    }

    private fun generatePassword(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun elapsed(start: Long): Long = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
}

internal fun startupDiagnostics(cli: File, env: Map<String, String>, log: KiloLog): String {
    val home = System.getProperty("user.home").orEmpty()
    val profile = EnvironmentUtil.getValue("USERPROFILE").orEmpty()
    val data = env["XDG_DATA_HOME"] ?: home.takeIf { it.isNotBlank() }?.let { File(it, ".local/share/kilo").absolutePath }.orEmpty()
    val lines = mutableListOf<String>()
    lines += "CLI binary: ${cli.absolutePath}${pathInfo(cli.absolutePath)}"
    lines += "user.home: ${home.ifBlank { "<unset>" }}${pathInfo(home)}"
    lines += "USERPROFILE: ${profile.ifBlank { "<unset>" }}${pathInfo(profile)}"
    lines += "CLI data home: ${data.ifBlank { "<unset>" }}${pathInfo(data)}"
    for (key in listOf("XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME")) {
        lines += "$key: ${env[key] ?: "<unset>"}"
    }
    if (data.isNotBlank() && remote(data)) {
        lines += "warning: Kilo CLI data dir appears to be on a non-local drive (${root(data)}); SQLite WAL may hang. Set XDG_DATA_HOME/XDG_STATE_HOME/XDG_CONFIG_HOME/XDG_CACHE_HOME to a local disk."
    }
    val text = lines.joinToString("\n")
    log.info("CLI startup diagnostics:\n$text")
    if (data.isNotBlank() && remote(data)) {
        log.warn("Kilo CLI data dir appears to be on a non-local drive (${root(data)}); SQLite WAL may hang. Set XDG_DATA_HOME/XDG_STATE_HOME/XDG_CONFIG_HOME/XDG_CACHE_HOME to a local disk.")
    }
    return text
}

private fun pathInfo(value: String): String {
    if (value.isBlank()) return ""
    val path = runCatching { Path.of(value) }.getOrNull() ?: return " (fs=<invalid>, unc=false)"
    return " (fs=${store(path)}, attrs=${attrs(path)}, unc=${unc(value)}, root=${root(value)})"
}

private fun store(path: Path): String = runCatching {
    val target = existing(path)
    Files.getFileStore(target).type().ifBlank { "<unknown>" }
}.getOrElse { "<unavailable: ${it.message}>" }

private fun existing(path: Path): Path {
    var current = path
    while (!Files.exists(current) && current.parent != null) current = current.parent
    return current
}

private fun remote(value: String): Boolean {
    if (unc(value)) return true
    val path = runCatching { Path.of(value) }.getOrNull() ?: return false
    val type = store(path).lowercase()
    val flags = attrs(path).lowercase()
    if (listOf("remote=true", "removable=true", "cdrom=true").any { flags.contains(it) }) return true
    return listOf("smb", "cifs", "nfs", "webdav", "afp", "sshfs", "remote").any { type.contains(it) }
}

private fun attrs(path: Path): String {
    val store = runCatching { Files.getFileStore(existing(path)) }.getOrNull() ?: return "<unavailable>"
    val keys = listOf("volume:isRemote" to "remote", "volume:isRemovable" to "removable", "volume:isCdrom" to "cdrom")
    return keys.mapNotNull { item ->
        runCatching { "${item.second}=${store.getAttribute(item.first)}" }.getOrNull()
    }.takeIf { it.isNotEmpty() }?.joinToString(",") ?: "<unavailable>"
}

private fun unc(value: String): Boolean = value.startsWith("\\\\")

private fun root(value: String): String {
    val path = runCatching { Path.of(value) }.getOrNull() ?: return "<unknown>"
    val root = path.root?.toString()
    if (root != null) return root
    if (SystemInfo.isWindows && value.length >= 2 && value[1] == ':') return value.take(2)
    return value
}

internal suspend fun awaitReady(
    stdout: InputStream,
    stderr: StringBuilder,
    pwd: String,
    timeoutMs: Long,
    alive: () -> Boolean,
    pid: () -> Long,
    code: () -> Int,
    onTimeout: () -> Unit,
    diagnostics: () -> String,
    log: KiloLog = KiloLog.create(KiloBackendCliManager::class.java),
    onThread: (Thread) -> Unit = {},
): CliServer.State {
    val done = CompletableDeferred<CliServer.State>()
    val timed = AtomicBoolean(false)
    fun complete(state: CliServer.State) {
        done.complete(state)
    }
    val thread = Thread({
        runCatching {
            BufferedReader(InputStreamReader(stdout)).use { reader ->
                for (line in reader.lineSequence()) {
                    log.info("CLI stdout: $line")
                    val match = PORT_REGEX.find(line)
                    if (match != null) {
                        val port = match.groupValues[1].toInt()
                        log.info("CLI server ready on port $port")
                        complete(CliServer.State.Ready(port = port, password = pwd))
                        return@Thread
                    }
                }
            }
            val value = if (timed.get()) null else runCatching { code() }.getOrNull()
            val text = synchronized(stderr) { stderr.toString().trim() }
            val extra = diagnostics().trim()
            val details = listOf(text, extra).filter { it.isNotEmpty() }.joinToString("\n\n")
            val msg = if (value == null) {
                "CLI stdout closed before announcing a port"
            } else {
                "CLI process exited with code $value before announcing a port"
            }
            log.warn("$msg: $details")
            complete(CliServer.State.Error(msg, details.ifEmpty { null }))
        }.onFailure { err ->
            if (!timed.get()) {
                log.warn("CLI stdout reader failed", err)
                complete(CliServer.State.Error("CLI stdout reader failed", err.stackTraceToString()))
            }
        }
    }, "kilo-cli-stdout").apply { isDaemon = true; start() }
    onThread(thread)

    return try {
        withTimeout(timeoutMs) { done.await() }
    } catch (_: TimeoutCancellationException) {
        timed.set(true)
        val message = "CLI did not announce a port within ${timeoutMs}ms (process alive=${alive()}, pid=${pid()})"
        log.warn(message)
        onTimeout()
        val err = synchronized(stderr) { stderr.toString().trim() }
        val details = listOf(err, diagnostics().trim()).filter { it.isNotEmpty() }.joinToString("\n\n")
        CliServer.State.Error(message, details.ifEmpty { null })
    }
}

private const val DEFAULT_CONFIG = """{"permission":{"edit":"ask","bash":"ask"}}"""

// Must be called from a background thread — devStorageEnv() performs blocking I/O (mkdirs).
internal fun buildKiloCliEnv(
    pwd: String,
    base: Map<String, String> = EnvironmentUtil.getEnvironmentMap(),
    log: KiloLog = KiloLog.create(KiloBackendCliManager::class.java),
): Map<String, String> = buildMap {
    putAll(base)
    put("KILO_SERVER_PASSWORD", pwd)
    put("KILO_CLIENT", "jetbrains")
    put("KILO_ENABLE_QUESTION_TOOL", "true")
    put("KILO_PLATFORM", "jetbrains")
    put("KILO_APP_NAME", "kilo-code")
    put("KILO_TELEMETRY_LEVEL", if (KiloDevMode.enabled()) "off" else "all")
    if (!KiloClaudeCompatSettings.get()) put("KILO_DISABLE_CLAUDE_CODE", "true")
    put("KILOCODE_FEATURE", "jetbrains-plugin")
    putIfAbsent("KILO_CONFIG_CONTENT", DEFAULT_CONFIG)
    ideEnv(log).forEach { entry -> put(entry.key, entry.value) }
    devStorageEnv(log)?.forEach { entry -> put(entry.key, entry.value) }
}

private fun ideEnv(log: KiloLog): Map<String, String> = buildMap {
    runCatching {
        val info = ApplicationInfo.getInstance()
        val name = info.fullApplicationName
        val build = info.build.asString()
        put("KILO_EDITOR_NAME", name)
        put("KILOCODE_EDITOR_NAME", "$name $build")
    }.onFailure { log.info("Could not read ApplicationInfo: ${it.message}") }

    runCatching {
        val version = KiloPlugin.version()
        if (version != null) put("KILO_APP_VERSION", version)
    }.onFailure { log.info("Could not read plugin version: ${it.message}") }

    runCatching {
        put("KILO_MACHINE_ID", machineId())
    }.onFailure { log.info("Could not read machine ID: ${it.message}") }
}

private fun machineId(): String {
    val file = File(PathManager.getSystemPath(), "kilo/machine-id")
    if (file.exists()) return file.readText().trim()
    val id = UUID.randomUUID().toString()
    file.parentFile.mkdirs()
    file.writeText(id)
    return id
}

private fun devStorageEnv(log: KiloLog): Map<String, String>? {
    val enabled = System.getProperty("kilo.dev.storage.isolated", "false").toBoolean()
    if (!enabled) return null
    val root = System.getProperty("kilo.dev.worktree.root") ?: run {
        log.warn("kilo.dev.storage.isolated=true but kilo.dev.worktree.root is not set; skipping dev storage isolation")
        return null
    }
    val dev = File(root, ".kilo-dev")
    val data = File(dev, "data")
    val config = File(dev, "config")
    val state = File(dev, "state")
    val cache = File(dev, "cache")
    for (dir in listOf(data, config, state, cache)) {
        if (!dir.mkdirs() && !dir.isDirectory) {
            log.warn("Failed to create dev storage dir ${dir.absolutePath}; skipping dev storage isolation")
            return null
        }
    }
    log.info("Dev storage isolation enabled under ${dev.absolutePath}")
    return mapOf(
        "XDG_DATA_HOME" to data.absolutePath,
        "XDG_CONFIG_HOME" to config.absolutePath,
        "XDG_STATE_HOME" to state.absolutePath,
        "XDG_CACHE_HOME" to cache.absolutePath,
    )
}
