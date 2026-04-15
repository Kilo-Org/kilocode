package ai.kilocode.backend.app

import ai.kilocode.backend.util.IntellijLog
import ai.kilocode.backend.util.KiloLog
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.util.SystemInfo
import com.intellij.util.system.CpuArch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

/**
 * Manages the Kilo CLI binary lifecycle.
 *
 * Extracts the bundled CLI from JAR resources into IntelliJ's system directory,
 * spawns `kilo serve --port 0`, and exposes the result as [State].
 *
 * Concurrency is handled by the owning [KiloBackendAppService] — all public
 * methods are called under its mutex so no internal synchronization is needed.
 */
class KiloBackendCliManager(
    private val log: KiloLog = IntellijLog(KiloBackendCliManager::class.java),
) : CliServer {

    companion object {
        private const val STARTUP_TIMEOUT_MS = 30_000L
        private const val KILL_TIMEOUT_SECONDS = 5L
        private val PORT_REGEX = Regex("""listening on http://[\w.]+:(\d+)""")
    }

    private var process: Process? = null
    private var hook: Thread? = null

    /**
     * When true, the next [extractCli] call deletes and re-extracts the binary
     * regardless of the size check. Reset to false after extraction.
     */
    @Volatile
    override var forceExtract = false

    override fun process(): Process? = process

    /**
     * Extract the CLI binary (if needed) and spawn `kilo serve`.
     *
     * Must be called under [KiloBackendAppService]'s mutex — no internal
     * synchronization is performed.
     */
    override suspend fun init(): CliServer.State {
        return try {
            val path = extractCli()
            log.info("CLI binary path: ${path.absolutePath} (size=${path.length()} bytes)")
            withTimeout(STARTUP_TIMEOUT_MS) {
                spawn(path)
            }
        } catch (e: Exception) {
            log.warn("CLI startup failed", e)
            // If spawn started a process but timed out (or failed after start),
            // kill the orphaned process so it doesn't leak.
            process?.let { proc ->
                log.info("Cleaning up orphaned CLI process (pid=${proc.pid()})")
                process = null
                uninstall()
                kill(proc, "startup failure cleanup")
            }
            CliServer.State.Error(
                message = e.message ?: "Unknown error",
                details = e.stackTraceToString(),
            )
        }
    }

    /**
     * Mark the given process as exited and clear state.
     * Called from the process monitor when the CLI process dies.
     */
    override fun exited(proc: Process) {
        if (process != proc) return
        process = null
        uninstall()
    }

    /**
     * Kill the running CLI process and reset state so the next [init] spawns fresh.
     */
    override fun stop() {
        val proc = process ?: return
        process = null
        uninstall()
        kill(proc, "stop()")
    }

    private fun extractCli(): File {
        val platform = platform()
        val exe = if (SystemInfo.isWindows) "kilo.exe" else "kilo"
        val resource = "cli/$platform/$exe"
        val loader = javaClass.classLoader

        val target = File(PathManager.getSystemPath(), "kilo/bin/$exe")

        if (forceExtract && target.exists()) {
            log.info("Force re-extracting CLI binary — deleting ${target.absolutePath}")
            target.delete()
            forceExtract = false
        }

        val url = loader.getResource(resource)
            ?: throw IllegalStateException("CLI binary not found in JAR resources at $resource")

        val size = url.openConnection().contentLengthLong
        if (size >= 0 && target.exists() && target.length() == size) {
            log.info("CLI binary up-to-date at ${target.absolutePath}")
            return target
        }

        log.info("Extracting CLI binary to ${target.absolutePath}")
        target.parentFile.mkdirs()

        url.openStream().use { input ->
            target.outputStream().use { output ->
                input.copyTo(output)
            }
        }

        if (!SystemInfo.isWindows) {
            target.setExecutable(true)
        }

        return target
    }

    private suspend fun spawn(cli: File): CliServer.State =
        withContext(Dispatchers.IO) {
            val pwd = generatePassword()

            val env = buildMap {
                putAll(System.getenv())
                put("KILO_SERVER_PASSWORD", pwd)
                put("KILO_CLIENT", "jetbrains")
                put("KILO_ENABLE_QUESTION_TOOL", "true")
                put("KILO_PLATFORM", "jetbrains")
                put("KILO_APP_NAME", "kilo-code")
            }

            val cmd = listOf(cli.absolutePath, "serve", "--port", "0")
            val builder = ProcessBuilder(cmd)
            builder.environment().clear()
            builder.environment().putAll(env)
            builder.redirectErrorStream(false)

            log.info("Starting CLI: ${cmd.joinToString(" ")}")
            log.info("CLI env: KILO_CLIENT=jetbrains KILO_PLATFORM=jetbrains KILO_APP_NAME=kilo-code")
            val proc = builder.start()
            log.info("CLI process started (pid=${proc.pid()})")
            process = proc
            install(proc)

            val stderr = StringBuilder()

            Thread({
                BufferedReader(InputStreamReader(proc.errorStream)).use { reader ->
                    reader.lineSequence().forEach { line ->
                        log.warn("CLI stderr: $line")
                        synchronized(stderr) { stderr.appendLine(line) }
                    }
                }
            }, "kilo-cli-stderr").apply { isDaemon = true; start() }

            BufferedReader(InputStreamReader(proc.inputStream)).use { reader ->
                for (line in reader.lineSequence()) {
                    log.info("CLI stdout: $line")
                    val match = PORT_REGEX.find(line)
                    if (match != null) {
                        val p = match.groupValues[1].toInt()
                        log.info("CLI server ready on port $p")
                        return@withContext CliServer.State.Ready(port = p, password = pwd)
                    }

                    if (!proc.isAlive) break
                }
            }

            val code = proc.waitFor()
            val details = synchronized(stderr) { stderr.toString().trim() }
            process = null
            uninstall()
            CliServer.State.Error(
                message = "CLI process exited with code $code before announcing a port",
                details = details.ifEmpty { null },
            )
        }

    override fun dispose() {
        val proc = process ?: return
        process = null
        uninstall()

        kill(proc, "Disposing")
    }

    private fun install(proc: Process) {
        uninstall()

        val next = Thread({
            log.info("Shutdown hook — killing CLI process tree (pid ${proc.pid()})")
            kill(proc, "Shutdown hook", wait = false)
        }, "kilo-cli-shutdown")

        val ok = runCatching {
            Runtime.getRuntime().addShutdownHook(next)
        }

        if (ok.isFailure) {
            log.warn("Failed to install CLI shutdown hook", ok.exceptionOrNull())
            return
        }

        hook = next
    }

    private fun uninstall() {
        val curr = hook ?: return
        hook = null

        val ok = runCatching {
            Runtime.getRuntime().removeShutdownHook(curr)
        }

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

    private fun children(proc: Process): List<ProcessHandle> {
        return proc.toHandle().descendants().toList().asReversed()
    }

    private fun platform(): String {
        val os = when {
            SystemInfo.isMac -> "darwin"
            SystemInfo.isLinux -> "linux"
            SystemInfo.isWindows -> "windows"
            else -> throw IllegalStateException(
                "Unsupported OS: ${
                    System.getProperty(
                        "os.name"
                    )
                }"
            )
        }
        val arch = when (CpuArch.CURRENT) {
            CpuArch.ARM64 -> "arm64"
            CpuArch.X86_64 -> "x64"
            else -> throw IllegalStateException("Unsupported architecture: ${CpuArch.CURRENT}")
        }
        return "$os-$arch"
    }

    private fun generatePassword(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
