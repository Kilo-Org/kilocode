// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.core

import ai.kilocode.jetbrains.i18n.I18n
import ai.kilocode.jetbrains.plugin.DebugMode
import ai.kilocode.jetbrains.plugin.WecoderPluginService
import ai.kilocode.jetbrains.util.ExtensionUtils
import ai.kilocode.jetbrains.util.NodeVersion
import ai.kilocode.jetbrains.util.NodeVersionUtil
import ai.kilocode.jetbrains.util.NotificationUtil
import ai.kilocode.jetbrains.util.PluginConstants
import ai.kilocode.jetbrains.util.PluginResourceUtil
import ai.kilocode.jetbrains.util.ProxyConfigUtil
import com.intellij.execution.configurations.PathEnvironmentVariableUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.util.SystemInfo
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Extension process manager
 * Responsible for starting and managing extension processes
 */
class ExtensionProcessManager : Disposable {
    companion object {
        // Node modules path
        private const val NODE_MODULES_PATH = PluginConstants.NODE_MODULES_PATH

        // Extension process entry file
        private const val EXTENSION_ENTRY_FILE = PluginConstants.EXTENSION_ENTRY_FILE

        // Plugin code directory
        private const val PLUGIN_CODE_DIR = PluginConstants.PLUGIN_CODE_DIR

        // Runtime directory
        private const val RUNTIME_DIR = PluginConstants.RUNTIME_DIR

        // Plugin ID
        private const val PLUGIN_ID = PluginConstants.PLUGIN_ID

        // Minimum required Node.js version
        private val MIN_REQUIRED_NODE_VERSION = NodeVersion(20, 6, 0, "20.6.0")
    }

    private val LOG = Logger.getInstance(ExtensionProcessManager::class.java)

    // Extension process
    private var process: Process? = null

    // Process monitor thread
    private var monitorThread: Thread? = null

    // Whether running
    @Volatile
    private var isRunning = false
    
    // Crash recovery state
    private val crashCount = AtomicInteger(0)
    private val lastCrashTime = AtomicLong(0)
    private val maxCrashesBeforeGiveUp = 3
    private val crashResetWindow = 300000L // 5 minutes
    private var lastPortOrPath: Any? = null

    /**
     * Start extension process
     * @param portOrPath Socket server port (Int) or UDS path (String)
     * @return Whether started successfully
     */
    fun start(portOrPath: Any?): Boolean {
        if (isRunning) {
            LOG.info("Extension process is already running")
            return true
        }
        
        // Store for potential restart
        lastPortOrPath = portOrPath
        
        val isUds = portOrPath is String
        if (!ExtensionUtils.isValidPortOrPath(portOrPath)) {
            LOG.error("Invalid socket info: $portOrPath")
            return false
        }

        try {
            // Prepare Node.js executable path
            val nodePath = findNodeExecutable()
            if (nodePath == null) {
                LOG.error("Failed to find Node.js executable")

                // Show notification to prompt user to install Node.js
                NotificationUtil.showError(
                    I18n.t("jetbrains:errors.nodejsMissing.title"),
                    I18n.t(
                        "jetbrains:errors.nodejsMissing.message",
                        mapOf("minVersion" to MIN_REQUIRED_NODE_VERSION),
                    ),
                )

                return false
            }

            // Check Node.js version
            val nodeVersion = NodeVersionUtil.getNodeVersion(nodePath)
            if (!NodeVersionUtil.isVersionSupported(nodeVersion, MIN_REQUIRED_NODE_VERSION)) {
                LOG.error("Node.js version is not supported: $nodeVersion, required: $MIN_REQUIRED_NODE_VERSION")

                NotificationUtil.showError(
                    I18n.t("jetbrains:errors.nodejsVersionLow.title"),
                    I18n.t(
                        "jetbrains:errors.nodejsVersionLow.message",
                        mapOf(
                            "nodePath" to nodePath,
                            "nodeVersion" to (nodeVersion?.toString() ?: "unknown"),
                            "minVersion" to MIN_REQUIRED_NODE_VERSION,
                        ),
                    ),
                )

                return false
            }

            // Prepare extension process entry file path
            val extensionPath = findExtensionEntryFile()
            if (extensionPath == null) {
                LOG.error("Failed to find extension entry file")
                return false
            }

            LOG.info("Starting extension process with node: $nodePath, entry: $extensionPath")

            val envVars = HashMap<String, String>(System.getenv())

            // Build complete PATH
            envVars["PATH"] = buildEnhancedPath(envVars, nodePath)
            LOG.info("Enhanced PATH for ${SystemInfo.getOsNameAndVersion()}: ${envVars["PATH"]}")

            // Add key environment variables
            if (isUds) {
                envVars["VSCODE_EXTHOST_IPC_HOOK"] = portOrPath.toString()
            } else {
                envVars["VSCODE_EXTHOST_WILL_SEND_SOCKET"] = "1"
                envVars["VSCODE_EXTHOST_SOCKET_HOST"] = "127.0.0.1"
                envVars["VSCODE_EXTHOST_SOCKET_PORT"] = portOrPath.toString()
            }

            // Build command line arguments
            val commandArgs = mutableListOf(
                nodePath,
                "--experimental-global-webcrypto",
                "--no-deprecation",
//                "--trace-uncaught",
                extensionPath,
                "--vscode-socket-port=${envVars["VSCODE_EXTHOST_SOCKET_PORT"]}",
                "--vscode-socket-host=${envVars["VSCODE_EXTHOST_SOCKET_HOST"]}",
                "--vscode-will-send-socket=${envVars["VSCODE_EXTHOST_WILL_SEND_SOCKET"]}",
            )

            // Get and set proxy configuration
            try {
                val proxyEnvVars = ProxyConfigUtil.getProxyEnvVarsForProcessStart()

                // Add proxy environment variables
                envVars.putAll(proxyEnvVars)

                // Log proxy configuration if used
                if (proxyEnvVars.isNotEmpty()) {
                    LOG.info("Applied proxy configuration for process startup")
                }
            } catch (e: Exception) {
                LOG.warn("Failed to configure proxy settings", e)
            }

            // Create process builder
            val builder = ProcessBuilder(commandArgs)

            // Print environment variables
            LOG.info("Environment variables:")
            envVars.forEach { (key, value) ->
                LOG.info("  $key = $value")
            }
            builder.environment().putAll(envVars)

            // Redirect error stream to standard output
            builder.redirectErrorStream(true)

            // Start process
            process = builder.start()

            // Start monitor thread
            monitorThread = Thread {
                monitorProcess()
            }.apply {
                name = "ExtensionProcessMonitor"
                isDaemon = true
                start()
            }

            isRunning = true
            LOG.info("Extension process started")
            return true
        } catch (e: Exception) {
            LOG.error("Failed to start extension process", e)
            stopInternal()
            return false
        }
    }

    /**
     * Monitor extension process
     */
    private fun monitorProcess() {
        val proc = process ?: return

        try {
            // Start log reading thread
            val logThread = Thread {
                proc.inputStream.bufferedReader().use { reader ->
                    var line: String?
                    while (reader.readLine().also { line = it } != null) {
                        LOG.info("Extension process: $line")
                    }
                }
            }
            logThread.name = "ExtensionProcessLogger"
            logThread.isDaemon = true
            logThread.start()

            // Wait for process to end
            val exitCode = try {
                proc.waitFor()
            } catch (e: InterruptedException) {
                LOG.info("Process monitor interrupted")
                -1
            }
            
            LOG.info("Extension process exited with code: $exitCode")

            // Ensure log thread ends
            logThread.interrupt()
            try {
                logThread.join(1000)
            } catch (e: InterruptedException) {
                // Ignore
            }
            
            // Handle unexpected crashes
            if (exitCode != 0 && !Thread.currentThread().isInterrupted) {
                handleProcessCrash(exitCode)
            }
        } catch (e: Exception) {
            LOG.error("Error monitoring extension process", e)
        } finally {
            synchronized(this) {
                if (process === proc) {
                    isRunning = false
                    process = null
                }
            }
        }
    }
    
    /**
     * Handle process crash and attempt recovery
     */
    private fun handleProcessCrash(exitCode: Int) {
        val now = System.currentTimeMillis()
        
        // Reset crash count if enough time has passed
        if (now - lastCrashTime.get() > crashResetWindow) {
            crashCount.set(0)
        }
        
        val crashes = crashCount.incrementAndGet()
        lastCrashTime.set(now)
        
        LOG.error("Extension process crashed with exit code $exitCode (crash #$crashes)")
        
        if (crashes <= maxCrashesBeforeGiveUp) {
            LOG.info("Attempting automatic restart (attempt $crashes/$maxCrashesBeforeGiveUp)")
            
            try {
                // Wait before restart with exponential backoff
                val delay = 2000L * crashes
                Thread.sleep(delay)
                
                // Attempt restart
                val portOrPath = lastPortOrPath
                if (portOrPath != null) {
                    val restarted = start(portOrPath)
                    if (restarted) {
                        LOG.info("Extension process restarted successfully after crash")
                    } else {
                        LOG.error("Failed to restart extension process after crash")
                    }
                } else {
                    LOG.error("Cannot restart: no port/path information available")
                }
            } catch (e: InterruptedException) {
                LOG.info("Restart attempt interrupted")
            } catch (e: Exception) {
                LOG.error("Error during crash recovery", e)
            }
        } else {
            LOG.error("Max crash count reached ($crashes), giving up on automatic restart")
            NotificationUtil.showError(
                I18n.t("jetbrains:errors.extensionCrashed.title"),
                I18n.t("jetbrains:errors.extensionCrashed.message", mapOf("crashes" to crashes))
            )
        }
    }

    /**
     * Stop extension process
     */
    fun stop() {
        if (!isRunning) {
            return
        }

        stopInternal()
    }

    /**
     * Internal stop logic
     */
    private fun stopInternal() {
        LOG.info("Stopping extension process")

        val proc = process
        if (proc != null) {
            try {
                // Try to close normally
                if (proc.isAlive) {
                    proc.destroy()

                    // Wait for process to end
                    if (!proc.waitFor(5, TimeUnit.SECONDS)) {
                        // Force terminate
                        proc.destroyForcibly()
                        proc.waitFor(2, TimeUnit.SECONDS)
                    }
                }
            } catch (e: Exception) {
                LOG.error("Error stopping extension process", e)
            }
        }

        // Interrupt monitor thread
        monitorThread?.interrupt()
        try {
            monitorThread?.join(1000)
        } catch (e: InterruptedException) {
            // Ignore
        }

        process = null
        monitorThread = null
        isRunning = false

        LOG.info("Extension process stopped")
    }

    /**
     * Find Node.js executable
     */
    private fun findNodeExecutable(): String? {
        // First check built-in Node.js
        val resourcesPath = PluginResourceUtil.getResourcePath(PLUGIN_ID, NODE_MODULES_PATH)
        if (resourcesPath != null) {
            val resourceDir = File(resourcesPath)
            if (resourceDir.exists() && resourceDir.isDirectory) {
                val nodeBin = if (SystemInfo.isWindows) {
                    File(resourceDir, "node.exe")
                } else {
                    File(resourceDir, ".bin/node")
                }

                if (nodeBin.exists() && nodeBin.canExecute()) {
                    return nodeBin.absolutePath
                }
            }
        }

        // Then check system path
        return findExecutableInPath("node")
    }

    /**
     * Find executable in system path
     */
    private fun findExecutableInPath(name: String): String? {
        val nodePath = PathEnvironmentVariableUtil.findExecutableInPathOnAnyOS("node")?.absolutePath
        LOG.info("System Node path: $nodePath")
        return nodePath
    }

    /**
     * Find extension process entry file
     * @param projectBasePath Current project root path
     */
    fun findExtensionEntryFile(): String? {
        // In debug mode, directly return resources path
        if (WecoderPluginService.getDebugMode() != DebugMode.NONE) {
            val debugEntry = java.nio.file.Paths.get(WecoderPluginService.getDebugResource(), RUNTIME_DIR, "src", EXTENSION_ENTRY_FILE).normalize().toFile()
            if (debugEntry.exists() && debugEntry.isFile) {
                LOG.info("[DebugMode] Using debug entry file: ${debugEntry.absolutePath}")
                return debugEntry.absolutePath
            } else {
                LOG.warn("[DebugMode] Debug entry file not found: ${debugEntry.absolutePath}")
            }
        }
        // Normal mode
        val resourcesPath = ai.kilocode.jetbrains.util.PluginResourceUtil.getResourcePath(PLUGIN_ID, "$RUNTIME_DIR/$EXTENSION_ENTRY_FILE")
        if (resourcesPath != null) {
            val resource = java.io.File(resourcesPath)
            if (resource.exists() && resource.isFile) {
                return resourcesPath
            }
        }
        return null
    }

    /**
     * Find plugin code directory
     */
    private fun findPluginCodeDir(): String? {
        val pluginDirPath = PluginResourceUtil.getResourcePath(PLUGIN_ID, PLUGIN_CODE_DIR)
        if (pluginDirPath != null) {
            val pluginCodeDir = File(pluginDirPath)
            if (pluginCodeDir.exists() && pluginCodeDir.isDirectory) {
                return pluginCodeDir.absolutePath
            }
        }

        LOG.warn("Plugin code directory not found")
        return null
    }

    /**
     * Find node_modules path
     */
    private fun findNodeModulesPath(): String? {
        val nodePath = PluginResourceUtil.getResourcePath(PLUGIN_ID, NODE_MODULES_PATH)
        if (nodePath != null) {
            val nodeDir = File(nodePath)
            if (nodeDir.exists() && nodeDir.isDirectory) {
                return nodeDir.absolutePath
            }
        }
        return null
    }

    /**
     * Build enhanced PATH environment variable
     * @param envVars Environment variable map
     * @param nodePath Node.js executable path
     * @return Enhanced PATH
     */
    private fun buildEnhancedPath(envVars: MutableMap<String, String>, nodePath: String): String {
        // Find current PATH value (Path on Windows)
        val currentPath = envVars.filterKeys { it.equals("PATH", ignoreCase = true) }
            .values.firstOrNull() ?: ""

        val pathBuilder = mutableListOf<String>()

        // Simplify: add Node directory to PATH head (npx usually in same dir as node)
        val nodeDir = File(nodePath).parentFile?.absolutePath
        if (nodeDir != null && !currentPath.contains(nodeDir)) {
            pathBuilder.add(nodeDir)
        }

        // Add common paths according to OS
        val commonDevPaths = when {
            SystemInfo.isMac -> listOf(
                "/opt/homebrew/bin",
                "/opt/homebrew/sbin",
                "/usr/local/bin",
                "/usr/local/sbin",
                "${System.getProperty("user.home")}/.local/bin",
            )
            SystemInfo.isWindows -> listOf(
                "C:\\Windows\\System32",
                "C:\\Windows\\SysWOW64",
                "C:\\Windows",
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
                "C:\\Program Files\\PowerShell\\7",
                "C:\\Program Files (x86)\\PowerShell\\7",
            )
            else -> emptyList()
        }

        // Add existing paths
        commonDevPaths.forEach { path ->
            if (File(path).exists() && !currentPath.contains(path)) {
                pathBuilder.add(path)
                LOG.info("Add path to PATH: $path")
            } else if (!File(path).exists()) {
                LOG.warn("Path does not exist, skip: $path")
            }
        }

        // Keep original PATH
        if (currentPath.isNotEmpty()) {
            pathBuilder.add(currentPath)
        }

        return pathBuilder.joinToString(File.pathSeparator)
    }

    /**
     * Whether running
     */
    fun isRunning(): Boolean {
        return isRunning && process?.isAlive == true
    }

    override fun dispose() {
        stop()
    }
}
