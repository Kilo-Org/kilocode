package ai.kilocode.jetbrains.plugin

import ai.kilocode.jetbrains.core.ExtensionProcessManager
import ai.kilocode.jetbrains.core.ExtensionSocketServer
import ai.kilocode.jetbrains.core.ExtensionUnixDomainSocketServer
import ai.kilocode.jetbrains.core.ISocketServer
import ai.kilocode.jetbrains.core.ServiceProxyRegistry
import ai.kilocode.jetbrains.monitoring.ScopeRegistry
import ai.kilocode.jetbrains.monitoring.ThreadMonitor
import ai.kilocode.jetbrains.monitoring.DisposableTracker
import ai.kilocode.jetbrains.util.ExtensionUtils
import ai.kilocode.jetbrains.util.PluginConstants
import ai.kilocode.jetbrains.util.PluginResourceUtil
import ai.kilocode.jetbrains.webview.WebViewManager
import ai.kilocode.jetbrains.workspace.WorkspaceFileChangeManager
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.ProjectManagerListener
import com.intellij.openapi.startup.StartupActivity
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.SystemInfo
import com.intellij.ui.jcef.JBCefApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.File
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.Properties
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors

/**
 * WeCode IDEA plugin entry class
 * Responsible for plugin initialization and lifecycle management
 */
class WecoderPlugin : StartupActivity.DumbAware {
    companion object {
        private val LOG = Logger.getInstance(WecoderPlugin::class.java)

        // Project manager listener for handling project lifecycle events
        private val projectManagerListener = object : ProjectManagerListener {
            override fun projectOpened(project: Project) {
                LOG.info("Project opened: ${project.name}")
                // Initialize plugin service for newly opened project
                try {
                    val pluginService = getInstance(project)
                    pluginService.initialize(project)
                } catch (e: Exception) {
                    LOG.error("Failed to initialize plugin for opened project: ${project.name}", e)
                }
            }

            override fun projectClosed(project: Project) {
                LOG.info("Project closed: ${project.name}")
                // Clean up resources for closed project
                try {
                    // Use getServiceIfCreated to avoid initializing service during disposal
                    val pluginService = project.getServiceIfCreated(WecoderPluginService::class.java)
                    pluginService?.dispose()
                } catch (e: Exception) {
                    LOG.error("Failed to dispose plugin for closed project: ${project.name}", e)
                }
            }

            override fun projectClosing(project: Project) {
                LOG.info("Project closing: ${project.name}")
                // Perform any pre-close cleanup
                try {
                    // Notify WebViewManager about impending project close
                    project.getService(WebViewManager::class.java).onProjectSwitch()
                } catch (e: Exception) {
                    LOG.error("Failed to handle project closing for: ${project.name}", e)
                }
            }
        }

        init {
            // Register the project manager listener
            try {
                val messageBus = ApplicationManager.getApplication().messageBus
                messageBus.connect().subscribe(ProjectManager.TOPIC, projectManagerListener)
                LOG.info("Project manager listener registered successfully")
            } catch (e: Exception) {
                LOG.error("Failed to register project manager listener", e)
            }
        }

        /**
         * Get plugin service instance
         */
        fun getInstance(project: Project): WecoderPluginService {
            return project.getService(WecoderPluginService::class.java)
                ?: error("WecoderPluginService not found")
        }

        /**
         * Get the basePath of the current project
         */
        @JvmStatic
        fun getProjectBasePath(project: Project): String? {
            return project.basePath
        }
    }

    override fun runActivity(project: Project) {
        val appInfo = ApplicationInfo.getInstance()
        val plugin = PluginManagerCore.getPlugin(PluginId.getId(PluginConstants.PLUGIN_ID))
        val pluginVersion = plugin?.version ?: "unknown"
        val osName = System.getProperty("os.name")
        val osVersion = System.getProperty("os.version")
        val osArch = System.getProperty("os.arch")

        LOG.info(
            "Initializing Kilo Code plugin for project: ${project.name}, " +
                "OS: $osName $osVersion ($osArch), " +
                "IDE: ${appInfo.fullApplicationName} (build ${appInfo.build}), " +
                "Plugin version: $pluginVersion, " +
                "JCEF supported: ${JBCefApp.isSupported()}",
        )

        try {
            // Initialize plugin service
            val pluginService = getInstance(project)
            pluginService.initialize(project)

            // Initialize WebViewManager and register to project Disposer
            val webViewManager = project.getService(WebViewManager::class.java)
            Disposer.register(project, webViewManager)

            // Register project-level resource disposal
            Disposer.register(
                project,
                Disposable {
                    LOG.info("Disposing Kilo Code plugin for project: ${project.name}")
                    pluginService.dispose()
                    // SystemObjectProvider is now project-scoped and will be disposed automatically
                },
            )

            LOG.info("Kilo Code plugin initialized successfully for project: ${project.name}")
        } catch (e: Exception) {
            LOG.error("Failed to initialize Kilo Code plugin", e)
        }
    }
}

/**
 * Debug mode enum
 */
enum class DebugMode {
    ALL, // All debug modes
    IDEA, // Only IDEA plugin debug
    NONE, // Debug not enabled
    ;

    companion object {
        /**
         * Parse debug mode from string
         * @param value String value
         * @return Corresponding debug mode
         */
        fun fromString(value: String): DebugMode {
            return when (value.lowercase()) {
                "all" -> ALL
                "idea" -> IDEA
                "true" -> ALL // backward compatibility
                "none", "" -> NONE
                else -> NONE
            }
        }
    }
}

/**
 * Plugin service class, provides global access point and core functionality
 */
@Service(Service.Level.PROJECT)
class WecoderPluginService(private var currentProject: Project) : Disposable {
    private val LOG = Logger.getInstance(WecoderPluginService::class.java)

    // Whether initialized
    @Volatile
    private var isInitialized = false
    
    // Disposal state
    @Volatile
    private var isDisposing = false
    
    @Volatile
    private var isDisposed = false

    // Plugin initialization complete flag
    private var initializationComplete = CompletableFuture<Boolean>()

    private val boundedIODispatcher = Executors.newFixedThreadPool(
        Runtime.getRuntime().availableProcessors() * 2,
        { r -> Thread(r, "KiloCode-IO").apply { isDaemon = true } }
    ).asCoroutineDispatcher()

    // Coroutine scope
    private val coroutineScope = CoroutineScope(boundedIODispatcher + SupervisorJob())
    private val threadMonitor = ThreadMonitor()

    // Service instances
    private val socketServer = ExtensionSocketServer()
    private val udsSocketServer = ExtensionUnixDomainSocketServer()
    private val processManager = ExtensionProcessManager()

    companion object {
        // Debug mode switch
        @Volatile
        private var DEBUG_TYPE: DebugMode = DebugMode.NONE

        @Volatile
        private var DEBUG_RESOURCE: String? = null

        // Debug mode connection address
        private const val DEBUG_HOST = "127.0.0.1"

        // Debug mode connection port
        private const val DEBUG_PORT = 51234

        // Initialize configuration at class load
        init {
            try {
                // Read debug mode setting from config file
                val properties = Properties()
                val configStream: InputStream? = WecoderPluginService::class.java.getResourceAsStream("/ai/kilocode/jetbrains/plugin/config/plugin.properties")

                if (configStream != null) {
                    properties.load(configStream)
                    configStream.close()

                    // Read debug mode config
                    val debugModeStr = properties.getProperty("debug.mode", "none").lowercase()
                    DEBUG_TYPE = DebugMode.fromString(debugModeStr)
                    DEBUG_RESOURCE = properties.getProperty("debug.resource", null)

                    Logger.getInstance(WecoderPluginService::class.java).info("Read debug mode from config file: $DEBUG_TYPE")
                } else {
                    Logger.getInstance(WecoderPluginService::class.java).warn("Cannot load config file, use default debug mode: $DEBUG_TYPE")
                }
            } catch (e: Exception) {
                Logger.getInstance(WecoderPluginService::class.java).warn("Error reading config file, use default debug mode: $DEBUG_TYPE", e)
            }
        }

        /**
         * Get current debug mode
         * @return Debug mode
         */
        @JvmStatic
        fun getDebugMode(): DebugMode {
            return DEBUG_TYPE
        }

        /**
         * Get debug resource path
         * @return Debug resource path
         */
        @JvmStatic
        fun getDebugResource(): String? {
            return DEBUG_RESOURCE
        }
    }

    /**
     * Initialize plugin service
     */
    fun initialize(project: Project) {
        // Check if disposing or disposed
        if (isDisposing || isDisposed) {
            LOG.warn("Cannot initialize: service is disposing or disposed")
            return
        }
        
        // Check if already initialized for the same project
        if (isInitialized && this.currentProject == project) {
            LOG.info("WecoderPluginService already initialized for project: ${project.name}")
            return
        }

        // If initialized for a different project, clean up first
        if (isInitialized && this.currentProject != project) {
            LOG.info("Switching projects from ${this.currentProject?.name} to ${project.name}, cleaning up previous state")

            // Notify WebViewManager about project switch
            this.currentProject?.getService(WebViewManager::class.java)?.onProjectSwitch()

            cleanup()
            isInitialized = false
            initializationComplete = CompletableFuture<Boolean>() // Reset completion flag
        }

        LOG.info("Initializing WecoderPluginService for project: ${project.name}, debug mode: $DEBUG_TYPE")

        // Initialize system object provider
        var systemObjectProvider = project.getService(SystemObjectProvider::class.java)
        systemObjectProvider.initialize(project)
        this.currentProject = project
        socketServer.project = project
        udsSocketServer.project = project

        // Register to system object provider
        systemObjectProvider.register("pluginService", this)
        threadMonitor.startMonitoring()
        ScopeRegistry.register("WecoderPluginService", coroutineScope)

        // Start initialization in background thread
        coroutineScope.launch {
            try {
                initPlatformFiles()
                // Get project path
                val projectPath = project.basePath ?: ""

                // Initialize service registration
                project.getService(ServiceProxyRegistry::class.java).initialize()
//                ServiceProxyRegistry.getInstance().initialize()

                if (DEBUG_TYPE == DebugMode.ALL) {
                    // Debug mode: directly connect to extension process in debug
                    LOG.info("Running in debug mode: ${DEBUG_TYPE}, will directly connect to $DEBUG_HOST:$DEBUG_PORT")

                    // connet to debug port
                    socketServer.connectToDebugHost(DEBUG_HOST, DEBUG_PORT)

                    // Initialization successful
                    isInitialized = true
                    initializationComplete.complete(true)
                    LOG.info("Debug mode connection successful, WecoderPluginService initialized for project: ${project.name}")
                } else {
                    // Normal mode: start Socket server and extension process
                    // 1. Start Socket server according to system, use UDS except on Windows
                    val server: ISocketServer = if (SystemInfo.isWindows) socketServer else udsSocketServer
                    val portOrPath = server.start(projectPath)
                    if (!ExtensionUtils.isValidPortOrPath(portOrPath)) {
                        LOG.error("Failed to start socket server for project: ${project.name}")
                        initializationComplete.complete(false)
                        return@launch
                    }

                    LOG.info("Socket server started on: $portOrPath for project: ${project.name}")
                    // 2. Start extension process
                    if (!processManager.start(portOrPath)) {
                        LOG.error("Failed to start extension process for project: ${project.name}")
                        server.stop()
                        initializationComplete.complete(false)
                        return@launch
                    }
                    // Initialization successful
                    isInitialized = true
                    initializationComplete.complete(true)
                    LOG.info("WecoderPluginService initialization completed for project: ${project.name}")
                }
            } catch (e: Exception) {
                LOG.error("Error during WecoderPluginService initialization for project: ${project.name}", e)
                cleanup()
                initializationComplete.complete(false)
            }
        }
    }

    private fun initPlatformFiles() {
        // Initialize platform related files
        val platformSuffix = when {
            SystemInfo.isWindows -> "windows-x64"
            SystemInfo.isMac -> when (System.getProperty("os.arch")) {
                "x86_64" -> "darwin-x64"
                "aarch64" -> "darwin-arm64"
                else -> ""
            }
            SystemInfo.isLinux -> "linux-x64"
            else -> ""
        }
        if (platformSuffix.isNotEmpty()) {
            val pluginDir = PluginResourceUtil.getResourcePath(PluginConstants.PLUGIN_ID, "")
                ?: throw IllegalStateException("Cannot get plugin directory")

            val platformFile = File(pluginDir, "platform.txt")
            if (platformFile.exists()) {
                platformFile.readLines()
                    .filter { it.isNotBlank() && !it.startsWith("#") }
                    .forEach { originalPath ->
                        val suffixedPath = "$originalPath$platformSuffix"
                        val originalFile = File(pluginDir, "node_modules/$originalPath")
                        val suffixedFile = File(pluginDir, "node_modules/$suffixedPath")

                        if (suffixedFile.exists()) {
                            if (originalFile.exists()) {
                                originalFile.delete()
                            }
                            Files.move(
                                suffixedFile.toPath(),
                                originalFile.toPath(),
                                StandardCopyOption.REPLACE_EXISTING,
                            )
                            originalFile.setExecutable(true)
                        }
                    }
            }
            platformFile.delete()
        }
    }

    /**
     * Wait for initialization to complete
     * @return Whether initialization was successful
     */
    fun waitForInitialization(): Boolean {
        return initializationComplete.get()
    }

    /**
     * Clean up resources
     */
    private fun cleanup() {
        LOG.info("Starting cleanup for project: ${currentProject?.name}")

        // First, stop the extension process to prevent new connections
        try {
            if (DEBUG_TYPE == DebugMode.NONE) {
                LOG.info("Stopping extension process")
                processManager.stop()
            }
        } catch (e: Exception) {
            LOG.error("Error stopping process manager", e)
        }

        // Wait a bit for the process to fully stop
        try {
            Thread.sleep(500)
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
        }

        // Then stop socket servers - this will close all client connections
        try {
            LOG.info("Stopping socket servers")
            socketServer.stop()
            udsSocketServer.stop()
        } catch (e: Exception) {
            LOG.error("Error stopping socket server", e)
        }

        // Wait for socket connections to be fully closed
        try {
            Thread.sleep(1000)
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
        }

        // Finally, clean up workspace file change listener
        try {
            currentProject?.getService(WorkspaceFileChangeManager::class.java)?.dispose()
        } catch (e: Exception) {
            LOG.error("Error disposing workspace file change manager", e)
        }

        isInitialized = false
        LOG.info("Cleanup completed for project: ${currentProject?.name}")
    }

    /**
     * Get whether initialized
     */
    fun isInitialized(): Boolean {
        return isInitialized
    }

    /**
     * Get Socket server
     */
    fun getSocketServer(): ExtensionSocketServer {
        return socketServer
    }

    /**
     * Get process manager
     */
    fun getProcessManager(): ExtensionProcessManager {
        return processManager
    }

    /**
     * Get current project
     */
    fun getCurrentProject(): Project? {
        return currentProject
    }

    /**
     * Close service
     */
    override fun dispose() {
        if (isDisposed) {
            LOG.warn("Service already disposed")
            return
        }
        
        if (!isInitialized) {
            isDisposed = true
            return
        }

        isDisposing = true
        LOG.info("Disposing WecoderPluginService")

        threadMonitor.dispose()
        ScopeRegistry.unregister("WecoderPluginService")

        currentProject?.getService(WebViewManager::class.java)?.dispose()

        // Cancel all coroutines
        coroutineScope.cancel()

        try {
            (boundedIODispatcher as? java.util.concurrent.ExecutorService)?.shutdown()
        } catch (e: Exception) {
            LOG.error("Error shutting down bounded IO dispatcher", e)
        }
        
        // Clean up resources
        cleanup()

        isDisposed = true
        isDisposing = false
        LOG.info("WecoderPluginService disposed")
    }
}
