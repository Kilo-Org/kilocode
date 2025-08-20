// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package com.sina.weibo.agent.plugin

import java.nio.file.Files
import java.nio.file.StandardCopyOption

import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.StartupActivity
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.Disposable
import com.sina.weibo.agent.core.ExtensionProcessManager
import com.sina.weibo.agent.core.ExtensionSocketServer
import com.sina.weibo.agent.core.ServiceProxyRegistry
import com.sina.weibo.agent.webview.WebViewManager
import com.sina.weibo.agent.workspace.WorkspaceFileChangeManager
import java.util.concurrent.CompletableFuture
import kotlinx.coroutines.*
import java.util.Properties
import java.io.InputStream
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.util.SystemInfo
import com.intellij.ui.jcef.JBCefApp
import com.intellij.openapi.application.ApplicationInfo
import com.sina.weibo.agent.core.*
import com.sina.weibo.agent.util.ExtensionUtils
import com.sina.weibo.agent.util.PluginConstants
import com.sina.weibo.agent.util.PluginResourceUtil
import java.io.File

/**
 * WeCode IDEA plugin entry class
 * Responsible for plugin initialization and lifecycle management
 */
class WecoderPlugin : StartupActivity.DumbAware {
    companion object {
        private val LOG = Logger.getInstance(WecoderPlugin::class.java)

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
            "Initializing RunVSAgent plugin for project: ${project.name}, " +
            "OS: $osName $osVersion ($osArch), " +
            "IDE: ${appInfo.fullApplicationName} (build ${appInfo.build}), " +
            "Plugin version: $pluginVersion, " +
            "JCEF supported: ${JBCefApp.isSupported()}"
        )

        try {
            // Initialize plugin service
            val pluginService = getInstance(project)
            pluginService.initialize(project)
            
            // Initialize WebViewManager and register to project Disposer
            val webViewManager = project.getService(WebViewManager::class.java)
            Disposer.register(project, webViewManager)
            
            // Register project-level resource disposal
            Disposer.register(project, Disposable {
                LOG.info("Disposing RunVSAgent plugin for project: ${project.name}")
                pluginService.dispose()
                SystemObjectProvider.dispose()
            })
            
            LOG.info("RunVSAgent plugin initialized successfully for project: ${project.name}")
        } catch (e: Exception) {
            LOG.error("Failed to initialize RunVSAgent plugin", e)
        }
    }
}

/**
 * Debug mode enum
 */
enum class DEBUG_MODE {
    ALL,    // All debug modes
    IDEA,   // Only IDEA plugin debug
    NONE;   // Debug not enabled
    
    companion object {
        /**
         * Parse debug mode from string
         * @param value String value
         * @return Corresponding debug mode
         */
        fun fromString(value: String): DEBUG_MODE {
            return when (value.lowercase()) {
                "all" -> ALL
                "idea" -> IDEA
                "true" -> ALL  // backward compatibility
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
    
    // Plugin initialization complete flag
    private val initializationComplete = CompletableFuture<Boolean>()
    
    // Coroutine scope
    private val coroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Service instances
    private val socketServer = ExtensionSocketServer()
    private val udsSocketServer = ExtensionUnixDomainSocketServer()
    private val processManager = ExtensionProcessManager()
    
    companion object {
        // Debug mode switch
        @Volatile
        private var DEBUG_TYPE: DEBUG_MODE = com.sina.weibo.agent.plugin.DEBUG_MODE.NONE

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
                val configStream: InputStream? = WecoderPluginService::class.java.getResourceAsStream("/com/sina/weibo/agent/plugin/config/plugin.properties")
                
                if (configStream != null) {
                    properties.load(configStream)
                    configStream.close()
                    
                    // Read debug mode config
                    val debugModeStr = properties.getProperty("debug.mode", "none").lowercase()
                    DEBUG_TYPE = DEBUG_MODE.fromString(debugModeStr)
                    DEBUG_RESOURCE = properties.getProperty("debug.resource", null)

                    Logger.getInstance(WecoderPluginService::class.java).info("Read debug mode from config file: $DEBUG_MODE")
                } else {
                    Logger.getInstance(WecoderPluginService::class.java).warn("Cannot load config file, use default debug mode: $DEBUG_MODE")
                }
            } catch (e: Exception) {
                Logger.getInstance(WecoderPluginService::class.java).warn("Error reading config file, use default debug mode: $DEBUG_MODE", e)
            }
        }

        /**
         * Get current debug mode
         * @return Debug mode
         */
        @JvmStatic
        fun getDebugMode(): DEBUG_MODE {
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
        // DEBUG_MODE is no longer set directly in code, now read from config file
        if (isInitialized) {
            LOG.info("WecoderPluginService already initialized")
            return
        }
        
        LOG.info("Initializing WecoderPluginService, debug mode: $DEBUG_TYPE")
        // Initialize system object provider
        SystemObjectProvider.initialize(project)
        this.currentProject = project
        socketServer.project = project
        udsSocketServer.project = project
        
        // Register to system object provider
        SystemObjectProvider.register("pluginService", this)
        
        // Start initialization in background thread
        coroutineScope.launch {
            try {
                initPlatformFiles()
                // Get project path
                val projectPath = project.basePath ?: ""

                // Initialize service registration
                project.getService(ServiceProxyRegistry::class.java).initialize()
//                ServiceProxyRegistry.getInstance().initialize()
                
                if (DEBUG_TYPE == com.sina.weibo.agent.plugin.DEBUG_MODE.ALL) {
                    // Debug mode: directly connect to extension process in debug
                    LOG.info("Running in debug mode: ${DEBUG_TYPE}, will directly connect to $DEBUG_HOST:$DEBUG_PORT")
                    
                    // connet to debug port
                    socketServer.connectToDebugHost(DEBUG_HOST, DEBUG_PORT)
                    
                    // Initialization successful
                    isInitialized = true
                    initializationComplete.complete(true)
                    LOG.info("Debug mode connection successful, WecoderPluginService initialized")
                } else {
                    // Normal mode: start Socket server and extension process
                    // 1. Start Socket server according to system, use UDS except on Windows
                    val server: ISocketServer = if (SystemInfo.isWindows) socketServer else udsSocketServer
                    val portOrPath = server.start(projectPath)
                    if (!ExtensionUtils.isValidPortOrPath(portOrPath)) {
                        LOG.error("Failed to start socket server")
                        initializationComplete.complete(false)
                        return@launch
                    }

                    LOG.info("Socket server started on: $portOrPath")
                    // 2. Start extension process
                    if (!processManager.start(portOrPath)) {
                        LOG.error("Failed to start extension process")
                        server.stop()
                        initializationComplete.complete(false)
                        return@launch
                    }
                    // Initialization successful
                    isInitialized = true
                    initializationComplete.complete(true)
                    LOG.info("WecoderPluginService initialization completed")
                }
            } catch (e: Exception) {
                LOG.error("Error during WecoderPluginService initialization", e)
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
                                StandardCopyOption.REPLACE_EXISTING
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
        try {
            // Stop extension process, only needed in non-debug mode
            if (DEBUG_TYPE == com.sina.weibo.agent.plugin.DEBUG_MODE.NONE) {
                processManager.stop()
            }
        } catch (e: Exception) {
            LOG.error("Error stopping process manager", e)
        }
        
        try {
            // Stop Socket server
            socketServer.stop()
            udsSocketServer.stop()
        } catch (e: Exception) {
            LOG.error("Error stopping socket server", e)
        }

        // Unregister workspace file change listener
        currentProject.getService(WorkspaceFileChangeManager::class.java).dispose()
//        WorkspaceFileChangeManager.disposeInstance()
        
        isInitialized = false
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
        if (!isInitialized) {
            return
        }
        
        LOG.info("Disposing WecoderPluginService")

        currentProject?.getService(WebViewManager::class.java)?.dispose()
        
        // Cancel all coroutines
        coroutineScope.cancel()
        
        // Clean up resources
        cleanup()
        
        LOG.info("WecoderPluginService disposed")
    }
}