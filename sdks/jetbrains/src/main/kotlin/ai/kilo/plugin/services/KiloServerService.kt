package ai.kilo.plugin.services

import ai.kilo.plugin.model.HealthResponse
import ai.kilo.plugin.settings.KiloSettings
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import kotlinx.coroutines.*
import kotlinx.serialization.json.Json
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import kotlin.random.Random

/**
 * Service responsible for managing the Kilo CLI server process.
 * Spawns a headless server on a random port and monitors its health.
 */
@Service(Service.Level.PROJECT)
class KiloServerService(private val project: Project) : Disposable {
    private val log = Logger.getInstance(KiloServerService::class.java)
    private val json = Json { ignoreUnknownKeys = true }

    private var serverProcess: Process? = null
    private var port: Int = 0
    private var serverJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @Volatile
    private var isRunning = false

    val baseUrl: String
        get() = "http://localhost:$port"

    val isServerRunning: Boolean
        get() = isRunning && serverProcess?.isAlive == true

    /**
     * Start the Kilo server process.
     * @return Result containing the port on success, or an exception on failure
     */
    suspend fun start(): Result<Int> {
        if (isServerRunning) {
            log.info("Kilo server already running on port $port")
            return Result.success(port)
        }

        // Use configured port or random
        val settings = KiloSettings.getInstance()
        port = settings.state.serverPort ?: Random.nextInt(16384, 65535)
        log.info("Starting Kilo server on port $port")

        val kiloBinary = findKiloBinary(project.basePath)
        if (kiloBinary == null) {
            val error = "Kilo CLI not found. Please install it or configure the path in Settings > Tools > Kilo."
            notifyError(error)
            return Result.failure(IllegalStateException(error))
        }

        return try {
            val workingDir = project.basePath?.let { File(it) } ?: File(System.getProperty("user.home"))

            val command = when {
                kiloBinary.startsWith("wsl::") -> {
                    val wslPath = kiloBinary.removePrefix("wsl::")
                    listOf("wsl", wslPath, "serve", "--port", port.toString())
                }
                kiloBinary.endsWith(".cmd", ignoreCase = true) ->
                    listOf("cmd.exe", "/c", kiloBinary, "serve", "--port", port.toString())
                kiloBinary.endsWith(".sh", ignoreCase = true) ->
                    listOf("sh", kiloBinary, "serve", "--port", port.toString())
                else ->
                    listOf(kiloBinary, "serve", "--port", port.toString())
            }

            val processBuilder = ProcessBuilder(command)
                .directory(workingDir)
                .redirectErrorStream(true)

            // Set environment variables
            processBuilder.environment()["OPENCODE_CALLER"] = "jetbrains"

            serverProcess = processBuilder.start()

            // Start log reader in background
            serverJob = scope.launch {
                serverProcess?.inputStream?.bufferedReader()?.use { reader ->
                    reader.lineSequence().forEach { line ->
                        log.debug("Kilo server: $line")
                    }
                }
            }

            // Wait for server to be ready
            val ready = waitForHealth(maxRetries = 30, delayMs = 200)
            if (ready) {
                isRunning = true
                notifyInfo("Kilo server started on port $port")
                log.info("Kilo server ready on port $port")
                Result.success(port)
            } else {
                stop()
                val error = "Kilo server failed to start (health check timeout)"
                notifyError(error)
                Result.failure(IllegalStateException(error))
            }
        } catch (e: Exception) {
            log.error("Failed to start Kilo server", e)
            notifyError("Failed to start Kilo server: ${e.message}")
            stop()
            Result.failure(e)
        }
    }

    /**
     * Stop the Kilo server process.
     */
    fun stop() {
        log.info("Stopping Kilo server")
        isRunning = false
        serverJob?.cancel()
        serverJob = null

        serverProcess?.let { process ->
            if (process.isAlive) {
                process.destroy()
                // Give it a moment to shut down gracefully
                Thread.sleep(500)
                if (process.isAlive) {
                    process.destroyForcibly()
                }
            }
        }
        serverProcess = null
        log.info("Kilo server stopped")
    }

    /**
     * Restart the server.
     */
    suspend fun restart(): Result<Int> {
        stop()
        delay(500)
        return start()
    }

    /**
     * Check if the server is healthy.
     */
    suspend fun checkHealth(): HealthResponse? {
        return withContext(Dispatchers.IO) {
            try {
                val connection = URI.create("$baseUrl/global/health").toURL().openConnection() as HttpURLConnection
                connection.connectTimeout = 1000
                connection.readTimeout = 1000
                connection.requestMethod = "GET"

                if (connection.responseCode == 200) {
                    val response = connection.inputStream.bufferedReader().readText()
                    json.decodeFromString<HealthResponse>(response)
                } else {
                    null
                }
            } catch (e: Exception) {
                null
            }
        }
    }

    /**
     * Wait for the server to become healthy.
     */
    private suspend fun waitForHealth(maxRetries: Int = 30, delayMs: Long = 200): Boolean {
        repeat(maxRetries) {
            val health = checkHealth()
            if (health?.healthy == true) {
                return true
            }

            // Check if process has died
            if (serverProcess?.isAlive == false) {
                log.warn("Kilo server process died unexpectedly")
                return false
            }

            delay(delayMs)
        }
        return false
    }

    /**
     * Find the Kilo CLI binary on the system.
     */
    private fun findKiloBinary(projectPath: String?): String? {
        return KiloCliDiscovery.findBinary(projectPath)
    }

    /**
     * Check if a binary is available and executable.
     */
    private fun isBinaryAvailable(path: String): Boolean {
        return try {
            val file = File(path)
            if (file.isAbsolute) {
                file.exists() && file.canExecute()
            } else {
                // For non-absolute paths, try to run --version
                val process = ProcessBuilder(path, "--version")
                    .redirectErrorStream(true)
                    .start()
                process.waitFor() == 0
            }
        } catch (e: Exception) {
            false
        }
    }

    private fun notifyInfo(message: String) {
        NotificationGroupManager.getInstance()
            .getNotificationGroup("Kilo Notifications")
            .createNotification(message, NotificationType.INFORMATION)
            .notify(project)
    }

    private fun notifyError(message: String) {
        NotificationGroupManager.getInstance()
            .getNotificationGroup("Kilo Notifications")
            .createNotification(message, NotificationType.ERROR)
            .notify(project)
    }

    override fun dispose() {
        scope.cancel()
        stop()
    }

    companion object {
        fun getInstance(project: Project): KiloServerService {
            return project.getService(KiloServerService::class.java)
        }
    }
}
