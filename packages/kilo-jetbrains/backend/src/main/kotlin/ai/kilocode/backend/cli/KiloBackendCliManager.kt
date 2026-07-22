package ai.kilocode.backend.cli

import ai.kilocode.KiloPlugin
import ai.kilocode.backend.dev.KiloDevMode
import ai.kilocode.log.KiloLog
import com.intellij.execution.process.OSProcessUtil
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
    @Volatile
    private var job: KiloProcessJob? = null
    private val lock = Any()
    private var closed = false
    private var hook: Thread? = null
    private var stderr: Thread? = null
    private var stdout: Thread? = null

    @Volatile
    override var forceExtract = false

    override fun process(): Process? = process

    override suspend fun init(onProgress: (CliDownload) -> Unit, onResolved: () -> Unit): CliServer.State {
        if (closed) return CliServer.State.Error("CLI manager is disposed")
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
            val proc = take()
            if (proc != null) {
                log.info("Cleaning up orphaned CLI process (pid=${proc.pid()})")
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
            val proc = take()
            if (proc != null) {
                log.info("Cleaning up orphaned CLI process (pid=${proc.pid()})")
                cleanup(proc, "startup failure cleanup")
            }
            CliServer.State.Error(
                message = e.message ?: "Unknown error",
                details = e.stackTraceToString(),
            )
        }
    }

    override fun exited(proc: Process) {
        val orphan = synchronized(lock) {
            if (process != proc) return
            process = null
            val current = job
            job = null
            uninstall()
            stderr = null
            current
        }
        orphan?.close()
        log.info("CLI process exited (pid=${proc.pid()}, exitCode=${runCatching { proc.exitValue() }.getOrNull()})")
    }

    override fun stop() {
        val proc = take() ?: return
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
            // Windows-only, best-effort: bind the CLI tree to the IDE via a kill-on-close job so it
            // can never be orphaned. Null on other platforms / when unavailable — see KiloProcessJob.
            val jobHandle = KiloProcessJob.assign(proc.pid(), log)
            val reject = synchronized(lock) {
                if (closed) return@synchronized true
                process = proc
                job = jobHandle
                install(proc)
                false
            }
            if (reject) {
                log.info("CLI process started after disposal; killing process tree (pid=${proc.pid()})")
                jobHandle?.close()
                cleanup(proc, "disposed startup cleanup")
                return@withContext CliServer.State.Error("CLI startup cancelled because service is disposed")
            }

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
            val current = synchronized(lock) {
                if (state !is CliServer.State.Error || process != proc) return@synchronized null
                process = null
                proc
            }
            if (current != null) {
                cleanup(proc, "startup error")
            }
            state
        }

    override fun dispose() {
        val proc = synchronized(lock) {
            closed = true
            val current = process
            process = null
            current
        } ?: return
        cleanup(proc, "Disposing")
    }

    /**
     * Fast teardown for IDE app close.
     *
     * Kill BEFORE touching the CLI's streams. On Windows, closing stderr/stdout while the reader
     * threads are still blocked in a native read hangs indefinitely — which deadlocked IDE shutdown
     * and left both the CLI and the IDE process alive (so the job's kill-on-close never fired, and a
     * manual kill was needed to unblock the next launch). Closing the job triggers kill-on-close so
     * the OS terminates the tree; [Process.destroy] is the no-job fallback. Both make the pending
     * reads return EOF, so [close] cannot block. We do not wait, so the shutdown thread (often the
     * EDT) is never blocked.
     */
    override fun closeForShutdown() {
        log.info("App close — closeForShutdown() entered")
        val state = synchronized(lock) {
            closed = true
            val proc = process
            val held = job
            job = null
            proc to held
        }
        val proc = state.first
        val orphanJob = state.second
        if (proc == null) {
            orphanJob?.close()
            log.info("App close — no live CLI process to stop (job present=${orphanJob != null})")
            return
        }
        closing = proc
        // Ordering is enforced (and regression-tested) in shutdownTree: kill first, close streams last.
        shutdownTree(proc, jobKill = orphanJob != null, log = log, killJob = { orphanJob?.close() })
    }

    private fun take(): Process? = synchronized(lock) {
        val proc = process
        process = null
        proc
    }

    private fun clearJob(): KiloProcessJob? = synchronized(lock) {
        val current = job
        job = null
        current
    }

    private fun cleanup(proc: Process, source: String) {
        closing = proc
        try {
            uninstall()
            clearJob()?.close()
            closeStreams(proc, log)
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
        killCliProcessTree(proc, log, wait = wait, timeoutSeconds = KILL_TIMEOUT_SECONDS)
    }

    private fun generatePassword(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun elapsed(start: Long): Long = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
}

internal fun killCliProcessTree(
    proc: Process,
    log: KiloLog,
    wait: Boolean = true,
    timeoutSeconds: Long = 5L,
    windows: Boolean = SystemInfo.isWindows,
) {
    if (windows) {
        val ok = runCatching { OSProcessUtil.killProcessTree(proc) }
            .onFailure { log.warn("killProcessTree failed for pid ${proc.pid()}", it) }
            .getOrDefault(false)
        // killProcessTree returns after its recursive call but does not wait for or
        // re-check the process, so a true result alone does not confirm exit.
        if (!wait) {
            if (!ok) {
                descendants(proc).forEach { it.destroyForcibly() }
                proc.destroyForcibly()
            }
            log.info("CLI process tree kill requested without wait (pid=${proc.pid()}, treeKill=$ok); exit not confirmed")
            return
        }
        if (ok && proc.waitFor(timeoutSeconds, TimeUnit.SECONDS)) {
            log.info("CLI process tree exited after kill (pid=${proc.pid()}, exitCode=${runCatching { proc.exitValue() }.getOrNull()})")
            return
        }
        log.info("CLI process tree kill fallback sending SIGKILL (pid=${proc.pid()})")
        descendants(proc).forEach { it.destroyForcibly() }
        proc.destroyForcibly()
        if (proc.waitFor(timeoutSeconds, TimeUnit.SECONDS)) {
            log.info("CLI process tree exited after SIGKILL fallback (pid=${proc.pid()})")
        } else {
            log.warn("CLI process still alive after SIGKILL fallback (pid=${proc.pid()})")
        }
        return
    }
    val original = descendants(proc)
    original.forEach { it.destroy() }
    proc.destroy()
    if (!wait) {
        // Shutdown-hook backstop: the graceful cleanup path uninstalls this hook before killing,
        // so if the hook still fires the CLI was never stopped cleanly. Escalate to SIGKILL right
        // away rather than risk orphaning a SIGTERM-ignoring tree on JVM exit; we cannot block here.
        original.forEach { it.destroyForcibly() }
        proc.destroyForcibly()
        log.info("CLI process tree SIGTERM+SIGKILL sent without wait (pid=${proc.pid()}); exit not confirmed")
        return
    }
    val parentExited = proc.waitFor(timeoutSeconds, TimeUnit.SECONDS)
    // Re-enumerate before SIGKILL: a tool/shell can fork new descendants during the grace
    // period, and killing the known processes can reparent them. Union the fresh scan with
    // the original handles so late children are escalated too.
    val kids = (original + descendants(proc)).distinctBy { it.pid() }
    if (parentExited && kids.none { it.isAlive }) {
        log.info("CLI process tree exited after SIGTERM (pid=${proc.pid()}, children=${kids.size})")
        return
    }
    log.warn(
        if (parentExited) "CLI child processes did not exit after SIGTERM, sending SIGKILL"
        else "CLI process did not exit after SIGTERM, sending SIGKILL"
    )
    kids.forEach { it.destroyForcibly() }
    proc.destroyForcibly()
    confirmKilled(proc, kids, log, timeoutSeconds)
}

/**
 * Confirm the tracked parent has exited after SIGKILL so callers observe a terminal state. The
 * parent is our direct child, so [Process.waitFor] reaps it deterministically. Descendants are
 * non-child handles: SIGKILL has been delivered, but an orphaned child reparents to init and can
 * briefly linger as an unreaped zombie that still reports alive, so we report them best-effort
 * rather than block on an exit we cannot observe from here.
 */
private fun confirmKilled(proc: Process, kids: List<ProcessHandle>, log: KiloLog, timeoutSeconds: Long) {
    val parentExited = proc.waitFor(timeoutSeconds, TimeUnit.SECONDS)
    val alive = kids.count { it.isAlive }
    if (parentExited && alive == 0) {
        log.info("CLI process tree exited after SIGKILL (pid=${proc.pid()}, children=${kids.size})")
        return
    }
    log.warn("CLI process tree escalated to SIGKILL (pid=${proc.pid()}, parentAlive=${!parentExited}, childrenReportedAlive=$alive)")
}

private fun descendants(proc: Process): List<ProcessHandle> =
    proc.toHandle().descendants().toList().asReversed()

/**
 * App-close teardown, in the order that matters on Windows: terminate the tree FIRST — close the
 * kill-on-close job ([killJob]), destroy descendants, destroy the parent — and only THEN close the
 * CLI's streams. Closing a process stream while a reader thread is blocked reading it hangs on
 * Windows until the process exits, so killing first makes those reads return EOF. Reversing this
 * order deadlocked IDE shutdown; the order is locked by KiloBackendCliShutdownTest. Never waits, so
 * the shutdown thread (often the EDT) is not blocked.
 */
internal fun shutdownTree(
    proc: Process,
    jobKill: Boolean,
    log: KiloLog,
    killJob: () -> Unit,
    descendants: (Process) -> List<ProcessHandle> = ::descendants,
) {
    killJob()
    descendants(proc).forEach { it.destroy() }
    proc.destroy()
    log.info("App close — CLI tree kill issued (pid=${proc.pid()}, jobKill=$jobKill); closing streams")
    closeStreams(proc, log)
    log.info("App close — CLI teardown complete (pid=${proc.pid()})")
}

internal fun closeStreams(proc: Process, log: KiloLog) {
    runCatching { proc.errorStream.close() }.onFailure { log.info("CLI stderr stream close skipped: ${it.message}") }
    runCatching { proc.inputStream.close() }.onFailure { log.info("CLI stdout stream close skipped: ${it.message}") }
    runCatching { proc.outputStream.close() }.onFailure { log.info("CLI stdin stream close skipped: ${it.message}") }
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

private const val DEFAULT_CONFIG = """{"permission":{"edit":"ask"}}"""

// Must be called from a background thread — devStorageEnv() performs blocking I/O (mkdirs).
internal fun buildKiloCliEnv(
    pwd: String,
    base: Map<String, String> = EnvironmentUtil.getEnvironmentMap(),
    log: KiloLog = KiloLog.create(KiloBackendCliManager::class.java),
): Map<String, String> = buildMap {
    putAll(base)
    put("KILO_SERVER_PASSWORD", pwd)
    // The CLI watches this PID and exits if the IDE process is hard-killed without a chance
    // to signal or run the JVM shutdown hook, so it is never orphaned. See parent-watchdog.ts.
    put("KILO_PARENT_PID", ProcessHandle.current().pid().toString())
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
