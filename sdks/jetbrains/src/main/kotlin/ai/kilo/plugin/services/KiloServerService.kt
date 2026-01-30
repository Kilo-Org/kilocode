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
     * @return The port the server is running on, or -1 if failed to start
     */
    suspend fun start(): Int {
        if (isServerRunning) {
            log.info("Kilo server already running on port $port")
            return port
        }

        // Use configured port or random
        val settings = KiloSettings.getInstance()
        port = settings.state.serverPort ?: Random.nextInt(16384, 65535)
        log.info("Starting Kilo server on port $port")

        val kiloBinary = findKiloBinary()
        if (kiloBinary == null) {
            notifyError("Kilo CLI not found. Please install it or configure the path in Settings > Tools > Kilo.")
            return -1
        }

        return try {
            val workingDir = project.basePath?.let { File(it) } ?: File(System.getProperty("user.home"))

            val processBuilder = ProcessBuilder(kiloBinary, "serve", "--port", port.toString())
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
                port
            } else {
                stop()
                notifyError("Kilo server failed to start (health check timeout)")
                -1
            }
        } catch (e: Exception) {
            log.error("Failed to start Kilo server", e)
            notifyError("Failed to start Kilo server: ${e.message}")
            stop()
            -1
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
    suspend fun restart(): Int {
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
    private fun findKiloBinary(): String? {
        // First check if user configured a custom path
        val settings = KiloSettings.getInstance()
        val customPath = settings.state.kiloExecutablePath
        if (customPath.isNotBlank()) {
            if (isBinaryAvailable(customPath)) {
                log.info("Using configured Kilo binary at: $customPath")
                return customPath
            }
            log.warn("Configured Kilo binary not found or not executable: $customPath")
        }

        // Check common locations
        val candidates = listOf(
            "kilo",
            "/usr/local/bin/kilo",
            "/opt/homebrew/bin/kilo",
            "${System.getProperty("user.home")}/.local/bin/kilo",
            "${System.getProperty("user.home")}/.bun/bin/kilo",
            // Also check for opencode (the upstream name)
            "opencode",
            "/usr/local/bin/opencode",
            "/opt/homebrew/bin/opencode",
            "${System.getProperty("user.home")}/.local/bin/opencode",
            "${System.getProperty("user.home")}/.bun/bin/opencode"
        )

        for (candidate in candidates) {
            if (isBinaryAvailable(candidate)) {
                log.info("Found Kilo binary at: $candidate")
                return candidate
            }
        }

        // Try to find via PATH using `which`
        return try {
            val process = ProcessBuilder("which", "kilo")
                .redirectErrorStream(true)
                .start()
            val result = process.inputStream.bufferedReader().readText().trim()
            if (process.waitFor() == 0 && result.isNotEmpty()) {
                log.info("Found Kilo binary via which: $result")
                result
            } else {
                // Try opencode
                val process2 = ProcessBuilder("which", "opencode")
                    .redirectErrorStream(true)
                    .start()
                val result2 = process2.inputStream.bufferedReader().readText().trim()
                if (process2.waitFor() == 0 && result2.isNotEmpty()) {
                    log.info("Found opencode binary via which: $result2")
                    result2
                } else {
                    null
                }
            }
        } catch (e: Exception) {
            log.warn("Failed to find Kilo binary via which", e)
            null
        }
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
