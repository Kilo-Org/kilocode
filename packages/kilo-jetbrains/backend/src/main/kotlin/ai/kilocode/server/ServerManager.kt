package ai.kilocode.server

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.util.SystemInfo
import com.intellij.util.system.CpuArch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

/**
 * Application-level service that manages the Kilo CLI binary lifecycle.
 *
 * Extracts the bundled CLI from JAR resources into IntelliJ's system directory,
 * spawns `kilo serve --port 0`, and exposes the result as [ServerState].
 *
 * All concurrent callers of [init] share the same startup flow — only one
 * CLI process is ever spawned.
 */
@Service(Service.Level.APP)
class ServerManager(private val cs: CoroutineScope) : Disposable {

  sealed class ServerState {
    data class Ready(val port: Int, val password: String) : ServerState()
    data class Error(val message: String, val details: String? = null) :
      ServerState()
  }

  companion object {
    private val LOG = Logger.getInstance(ServerManager::class.java)
    private const val STARTUP_TIMEOUT_MS = 30_000L
    private const val KILL_TIMEOUT_SECONDS = 5L
    private val PORT_REGEX = Regex("""listening on http://[\w.]+:(\d+)""")
  }

  private val mutex = Mutex()
  private var pending: Deferred<ServerState>? = null
  private var process: Process? = null
  private var hook: Thread? = null

  /**
   * When true, the next [extractCli] call deletes and re-extracts the binary
   * regardless of the size check. Reset to false after extraction.
   */
  @Volatile
  var forceExtract = false

  fun process(): Process? = process

  suspend fun init(): ServerState {
    val wait = mutex.withLock {
      val curr = pending
      if (curr != null && (!curr.isCompleted || process?.isAlive == true)) {
        return@withLock curr
      }

      cs.async(Dispatchers.IO) { start() }.also {
        pending = it
      }
    }
    return wait.await()
  }

  suspend fun exited(proc: Process) {
    mutex.withLock {
      if (process != proc) return@withLock
      process = null
      pending = null
      uninstall()
    }
  }

  /** Kill the running CLI process and reset state so the next [init] spawns fresh. */
  suspend fun stop() {
    mutex.withLock {
      val proc = process ?: return@withLock
      process = null
      pending = null
      uninstall()
      kill(proc, "stop()")
    }
  }

  private suspend fun start(): ServerState {
    return try {
      val path = extractCli()
      LOG.info("CLI binary path: ${path.absolutePath} (size=${path.length()} bytes)")
      withTimeout(STARTUP_TIMEOUT_MS) {
        spawn(path)
      }
    } catch (e: Exception) {
      LOG.warn("CLI startup failed", e)
      ServerState.Error(
        message = e.message ?: "Unknown error",
        details = e.stackTraceToString(),
      )
    }
  }

  private fun extractCli(): File {
    val platform = platform()
    val exe = if (SystemInfo.isWindows) "kilo.exe" else "kilo"
    val resource = "cli/$platform/$exe"
    val loader = javaClass.classLoader

    val target = File(PathManager.getSystemPath(), "kilo/bin/$exe")

    if (forceExtract && target.exists()) {
      LOG.info("Force re-extracting CLI binary — deleting ${target.absolutePath}")
      target.delete()
      forceExtract = false
    }

    val url = loader.getResource(resource)
      ?: throw IllegalStateException("CLI binary not found in JAR resources at $resource")

    val size = url.openConnection().contentLengthLong
    if (size >= 0 && target.exists() && target.length() == size) {
      LOG.info("CLI binary up-to-date at ${target.absolutePath}")
      return target
    }

    LOG.info("Extracting CLI binary to ${target.absolutePath}")
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

  private suspend fun spawn(cli: File): ServerState =
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

      LOG.info("Starting CLI: ${cmd.joinToString(" ")}")
      LOG.info("CLI env: KILO_CLIENT=jetbrains KILO_PLATFORM=jetbrains KILO_APP_NAME=kilo-code")
      val proc = builder.start()
      LOG.info("CLI process started (pid=${proc.pid()})")
      process = proc
      install(proc)

      val stderr = StringBuilder()

      Thread({
        BufferedReader(InputStreamReader(proc.errorStream)).use { reader ->
          reader.lineSequence().forEach { line ->
            LOG.warn("CLI stderr: $line")
            synchronized(stderr) { stderr.appendLine(line) }
          }
        }
      }, "kilo-cli-stderr").apply { isDaemon = true; start() }

      BufferedReader(InputStreamReader(proc.inputStream)).use { reader ->
        for (line in reader.lineSequence()) {
          LOG.info("CLI stdout: $line")
          val match = PORT_REGEX.find(line)
          if (match != null) {
            val p = match.groupValues[1].toInt()
            LOG.info("CLI server ready on port $p")
            return@withContext ServerState.Ready(port = p, password = pwd)
          }

          if (!proc.isAlive) break
        }
      }

      val code = proc.waitFor()
      val details = synchronized(stderr) { stderr.toString().trim() }
      process = null
      uninstall()
      ServerState.Error(
        message = "CLI process exited with code $code before announcing a port",
        details = details.ifEmpty { null },
      )
    }

  override fun dispose() {
    val proc = process ?: return
    process = null
    pending = null
    uninstall()

    kill(proc, "Disposing")
  }

  private fun install(proc: Process) {
    uninstall()

    val next = Thread({
      LOG.info("Shutdown hook — killing CLI process tree (pid ${proc.pid()})")
      kill(proc, "Shutdown hook", wait = false)
    }, "kilo-cli-shutdown")

    val ok = runCatching {
      Runtime.getRuntime().addShutdownHook(next)
    }

    if (ok.isFailure) {
      LOG.warn("Failed to install CLI shutdown hook", ok.exceptionOrNull())
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
      LOG.info("Skipping CLI shutdown hook removal: ${ok.exceptionOrNull()?.message}")
    }
  }

  private fun kill(proc: Process, source: String, wait: Boolean = true) {
    LOG.info("$source — killing CLI process tree (pid ${proc.pid()})")
    children(proc).forEach { it.destroy() }
    proc.destroy()

    if (!wait) return

    if (!proc.waitFor(KILL_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
      LOG.warn("CLI process did not exit after SIGTERM, sending SIGKILL")
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
