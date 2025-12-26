package ai.kilocode.jetbrains.ui

import ai.kilocode.jetbrains.actions.OpenDevToolsAction
import ai.kilocode.jetbrains.core.PluginContext
import ai.kilocode.jetbrains.plugin.DebugMode
import ai.kilocode.jetbrains.plugin.WecoderPlugin
import ai.kilocode.jetbrains.plugin.WecoderPluginService
import ai.kilocode.jetbrains.util.NodeVersionUtil
import ai.kilocode.jetbrains.util.PluginConstants
import ai.kilocode.jetbrains.webview.DragDropHandler
import ai.kilocode.jetbrains.webview.WebViewCreationCallback
import ai.kilocode.jetbrains.webview.WebViewInstance
import ai.kilocode.jetbrains.webview.WebViewManager
import com.intellij.ide.BrowserUtil
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.Toolkit
import java.awt.datatransfer.StringSelection
import javax.swing.JButton
import javax.swing.JLabel
import javax.swing.JPanel

class RooToolWindowFactory : ToolWindowFactory {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        // Initialize plugin service
        val pluginService = WecoderPlugin.getInstance(project)
        pluginService.initialize(project)

        // toolbar
        val titleActions = mutableListOf<AnAction>()
        val action = ActionManager.getInstance().getAction("WecoderToolbarGroup")
        if (action != null) {
            titleActions.add(action)
        }
        // Add developer tools button only in debug mode
        if (WecoderPluginService.getDebugMode() != DebugMode.NONE) {
            titleActions.add(OpenDevToolsAction { project.getService(WebViewManager::class.java).getLatestWebView() })
        }

        toolWindow.setTitleActions(titleActions)

        // webview panel
        val rooToolWindowContent = RooToolWindowContent(project, toolWindow)
        val contentFactory = ContentFactory.getInstance()
        val content = contentFactory.createContent(
            rooToolWindowContent.content,
            "",
            false,
        )
        toolWindow.contentManager.addContent(content)
    }

    private class RooToolWindowContent(
        private val project: Project,
        private val toolWindow: ToolWindow,
    ) : WebViewCreationCallback {
        private val logger = Logger.getInstance(RooToolWindowContent::class.java)

        // Get WebViewManager instance
        private val webViewManager = project.getService(WebViewManager::class.java)

        // Content panel
        private val contentPanel = JPanel(BorderLayout())

        // Placeholder label
        private val placeholderLabel = JLabel(createSystemInfoText())

        // System info text for copying - will be updated
        private var systemInfoText = createSystemInfoPlainText()
        
        // Timer for updating status display
        private var statusUpdateTimer: java.util.Timer? = null

        /**
         * Get initialization state text from state machine
         */
        private fun getInitStateText(): String {
            val pluginContext = try {
                project.getService(PluginContext::class.java)
            } catch (e: Exception) {
                null
            }
            
            val extensionHostManager = pluginContext?.getExtensionHostManager()
            val initState = extensionHostManager?.stateMachine?.getCurrentState()
            return when (initState?.name) {
                null -> "Initializing..."
                "NOT_STARTED" -> "Starting..."
                "SOCKET_CONNECTING" -> "Connecting to extension host..."
                "SOCKET_CONNECTED" -> "Connected to extension host"
                "READY_RECEIVED" -> "Extension host ready"
                "INIT_DATA_SENT" -> "Sending initialization data..."
                "INITIALIZED_RECEIVED" -> "Extension host initialized"
                "RPC_CREATING" -> "Creating RPC protocol..."
                "RPC_CREATED" -> "RPC protocol created"
                "EXTENSION_ACTIVATING" -> "Activating extension..."
                "EXTENSION_ACTIVATED" -> "Extension activated"
                "WEBVIEW_REGISTERING" -> "Registering webview..."
                "WEBVIEW_REGISTERED" -> "Webview registered"
                "WEBVIEW_RESOLVING" -> "Resolving webview..."
                "WEBVIEW_RESOLVED" -> "Webview resolved"
                "HTML_LOADING" -> "Loading UI..."
                "HTML_LOADED" -> "UI loaded"
                "THEME_INJECTING" -> "Applying theme..."
                "THEME_INJECTED" -> "Theme applied"
                "COMPLETE" -> "Ready"
                "FAILED" -> "Failed"
                else -> initState.name.replace("_", " ").lowercase().replaceFirstChar { it.uppercase() }
            }
        }

        /**
         * Create system information text in HTML format
         */
        private fun createSystemInfoText(): String {
            val appInfo = ApplicationInfo.getInstance()
            val plugin = PluginManagerCore.getPlugin(PluginId.getId(PluginConstants.PLUGIN_ID))
            val pluginVersion = plugin?.version ?: "unknown"
            val osName = System.getProperty("os.name")
            val osVersion = System.getProperty("os.version")
            val osArch = System.getProperty("os.arch")
            val jcefSupported = JBCefApp.isSupported()

            // Check for Linux ARM system
            val isLinuxArm = osName.lowercase().contains("linux") && (osArch.lowercase().contains("aarch64") || osArch.lowercase().contains("arm"))
            
            // Get initialization status
            val initStateText = getInitStateText()
            
            // Get Node.js version
            val nodeVersion = try {
                val nodePath = ai.kilocode.jetbrains.util.PluginResourceUtil.getResourcePath(
                    PluginConstants.PLUGIN_ID,
                    PluginConstants.NODE_MODULES_PATH
                )?.let { resourcePath ->
                    val nodeFile = java.io.File(resourcePath, if (System.getProperty("os.name").lowercase().contains("windows")) "node.exe" else ".bin/node")
                    if (nodeFile.exists()) nodeFile.absolutePath else null
                } ?: com.intellij.execution.configurations.PathEnvironmentVariableUtil.findExecutableInPathOnAnyOS("node")?.absolutePath
                
                if (nodePath != null) {
                    NodeVersionUtil.getNodeVersion(nodePath)?.toString() ?: "unknown"
                } else {
                    "not found"
                }
            } catch (e: Exception) {
                "error: ${e.message}"
            }

            return buildString {
                append("<html><body style='width: 400px; padding: 8px;'>")
                append("<h3>Kilo Code Initialization</h3>")
                append("<p><b>Status:</b> $initStateText</p>")                
                append("<h3>System Information</h3>")
                append("<table>")
                append("<tr><td><b>Node.js Version:</b></td><td>$nodeVersion</td></tr>")
                append("<tr><td><b>CPU Architecture:</b></td><td>$osArch</td></tr>")
                append("<tr><td><b>Operating System:</b></td><td>$osName $osVersion</td></tr>")
                append("<tr><td><b>IDE Version:</b></td><td>${appInfo.fullApplicationName} (build ${appInfo.build})</td></tr>")
                append("<tr><td><b>Plugin Version:</b></td><td>$pluginVersion</td></tr>")
                append("<tr><td><b>JCEF Support:</b></td><td>${if (jcefSupported) "Yes" else "No"}</td></tr>")
                append("</table>")

                // Add warning messages
                append("<br>")
                if (isLinuxArm) {
                    append("<div style='background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; border-radius: 4px; color: #856404;'>")
                    append("<b>⚠️ System Not Supported</b><br>")
                    append("Linux ARM systems are not currently supported by this plugin.")
                    append("</div>")
                    append("<br>")
                }

                if (!jcefSupported) {
                    append("<div style='background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; border-radius: 4px; color: #721c24;'>")
                    append("<b>⚠️ JCEF Not Supported</b><br>")
                    append("Your IDE runtime does not support JCEF. Please use a JCEF-enabled runtime.<br>")
                    append("<a href='https://kilo.ai/docs/jetbrains-troubleshooting' target='_blank' style='color: #721c24; text-decoration: underline;'>See JetBrains docs for how to enable JCEF in your IDE</a>")
                    append("</div>")
                    append("<br>")
                }

                // Add Known Issues text without link
                append("<div style='text-align: center; margin-top: 10px;'>")
                append("If this interface persists for a long time, you can refer to the ")
                append(" known issues documentation to check if there are any known problems.")
                append("</div>")

                append("</body></html>")
            }
        }

        /**
         * Create system information text in plain text format for copying
         */
        private fun createSystemInfoPlainText(): String {
            val appInfo = ApplicationInfo.getInstance()
            val plugin = PluginManagerCore.getPlugin(PluginId.getId(PluginConstants.PLUGIN_ID))
            val pluginVersion = plugin?.version ?: "unknown"
            val osName = System.getProperty("os.name")
            val osVersion = System.getProperty("os.version")
            val osArch = System.getProperty("os.arch")
            val jcefSupported = JBCefApp.isSupported()

            // Check for Linux ARM system
            val isLinuxArm = osName.lowercase().contains("linux") && (osArch.lowercase().contains("aarch64") || osArch.lowercase().contains("arm"))
            
            // Get initialization status
            val initStateText = getInitStateText()
            
            // Get Node.js version
            val nodeVersion = try {
                val nodePath = ai.kilocode.jetbrains.util.PluginResourceUtil.getResourcePath(
                    PluginConstants.PLUGIN_ID,
                    PluginConstants.NODE_MODULES_PATH
                )?.let { resourcePath ->
                    val nodeFile = java.io.File(resourcePath, if (System.getProperty("os.name").lowercase().contains("windows")) "node.exe" else ".bin/node")
                    if (nodeFile.exists()) nodeFile.absolutePath else null
                } ?: com.intellij.execution.configurations.PathEnvironmentVariableUtil.findExecutableInPathOnAnyOS("node")?.absolutePath
                
                if (nodePath != null) {
                    NodeVersionUtil.getNodeVersion(nodePath)?.toString() ?: "unknown"
                } else {
                    "not found"
                }
            } catch (e: Exception) {
                "error: ${e.message}"
            }

            return buildString {
                append("Kilo Code Initialization\n")
                append("========================\n")
                append("Status: $initStateText\n")
                append("\n")
                append("System Information\n")
                append("==================\n")
                append("Node.js Version: $nodeVersion\n")
                append("CPU Architecture: $osArch\n")
                append("Operating System: $osName $osVersion\n")
                append("IDE Version: ${appInfo.fullApplicationName} (build ${appInfo.build})\n")
                append("Plugin Version: $pluginVersion\n")
                append("JCEF Support: ${if (jcefSupported) "Yes" else "No"}\n")

                // Add warning messages
                append("\n")
                if (isLinuxArm) {
                    append("WARNING: System Not Supported\n")
                    append("Linux ARM systems are not currently supported by this plugin.\n")
                    append("\n")
                }

                if (!jcefSupported) {
                    append("WARNING: JCEF Not Supported\n")
                    append("Your IDE runtime does not support JCEF. Please use a JCEF-enabled runtime.\n")
                    append("See Known Issues for more information\n")
                    append("\n")
                }
            }
        }

        /**
         * Copy system information to clipboard
         */
        private fun copySystemInfo() {
            val stringSelection = StringSelection(systemInfoText)
            val clipboard = Toolkit.getDefaultToolkit().getSystemClipboard()
            clipboard.setContents(stringSelection, null)
        }

        // Known Issues button
        private val knownIssuesButton = JButton("Known Issues").apply {
            preferredSize = Dimension(150, 30)
            addActionListener {
                // TODO: Update to point to actual known issues documentation
                BrowserUtil.browse("https://kilo.ai/docs")
            }
        }

        // Copy button
        private val copyButton = JButton("Copy System Info").apply {
            preferredSize = Dimension(150, 30)
            addActionListener { copySystemInfo() }
        }

        // Button panel to hold both buttons side by side
        private val buttonPanel = JPanel().apply {
            layout = BorderLayout()
            add(knownIssuesButton, BorderLayout.WEST)
            add(copyButton, BorderLayout.EAST)
        }

        private var dragDropHandler: DragDropHandler? = null

        // Main panel
        val content: JPanel = JPanel(BorderLayout()).apply {
            // Set content panel with both label and button
            contentPanel.layout = BorderLayout()
            contentPanel.add(placeholderLabel, BorderLayout.CENTER)

            // Add button panel at the bottom of content panel
            contentPanel.add(buttonPanel, BorderLayout.SOUTH)

            add(contentPanel, BorderLayout.CENTER)
        }

        init {
            // Start timer to update status display
            startStatusUpdateTimer()
            
            // Try to get existing WebView
            webViewManager.getLatestWebView()?.let { webView ->
                // Add WebView component immediately when created
                ApplicationManager.getApplication().invokeLater {
                    addWebViewComponent(webView)
                }
                // Set page load callback to hide system info only after page is loaded
                webView.setPageLoadCallback {
                    ApplicationManager.getApplication().invokeLater {
                        hideSystemInfo()
                        stopStatusUpdateTimer()
                    }
                }
                // If page is already loaded, hide system info immediately
                if (webView.isPageLoaded()) {
                    ApplicationManager.getApplication().invokeLater {
                        hideSystemInfo()
                        stopStatusUpdateTimer()
                    }
                }
            } ?: webViewManager.addCreationCallback(this, toolWindow.disposable)
        }
        
        /**
         * Start timer to update status display
         */
        private fun startStatusUpdateTimer() {
            statusUpdateTimer = java.util.Timer().apply {
                scheduleAtFixedRate(object : java.util.TimerTask() {
                    override fun run() {
                        ApplicationManager.getApplication().invokeLater {
                            updateStatusDisplay()
                        }
                    }
                }, 500, 500) // Update every 500ms
            }
        }
        
        /**
         * Stop status update timer
         */
        private fun stopStatusUpdateTimer() {
            statusUpdateTimer?.cancel()
            statusUpdateTimer?.purge()
            statusUpdateTimer = null
        }
        
        /**
         * Update status display
         */
        private fun updateStatusDisplay() {
            try {
                placeholderLabel.text = createSystemInfoText()
                systemInfoText = createSystemInfoPlainText()
            } catch (e: Exception) {
                logger.error("Error updating status display", e)
            }
        }

        /**
         * WebView creation callback implementation
         */
        override fun onWebViewCreated(instance: WebViewInstance) {
            // Add WebView component immediately when created
            ApplicationManager.getApplication().invokeLater {
                addWebViewComponent(instance)
            }
            // Set page load callback to hide system info only after page is loaded
            instance.setPageLoadCallback {
                // Ensure UI update in EDT thread
                ApplicationManager.getApplication().invokeLater {
                    hideSystemInfo()
                }
            }
        }

        /**
         * Add WebView component to UI
         */
        private fun addWebViewComponent(webView: WebViewInstance) {
            logger.info("Adding WebView component to UI: ${webView.viewType}/${webView.viewId}")

            // Check if WebView component is already added
            val components = contentPanel.components
            for (component in components) {
                if (component === webView.browser.component) {
                    logger.info("WebView component already exists in UI")
                    return
                }
            }
            
            // Remove placeholder and buttons before adding webview
            contentPanel.removeAll()

            // Add WebView component
            contentPanel.add(webView.browser.component, BorderLayout.CENTER)

            setupDragAndDropSupport(webView)

            // Relayout
            contentPanel.revalidate()
            contentPanel.repaint()
            
            // Stop status update timer since webview is now visible
            stopStatusUpdateTimer()

            logger.info("WebView component added to tool window, placeholder removed")
        }

        /**
         * Hide system info placeholder
         */
        private fun hideSystemInfo() {
            logger.info("Hiding system info placeholder")
            
            // Stop status update timer
            stopStatusUpdateTimer()

            // Remove all components from content panel except WebView component
            val components = contentPanel.components
            for (component in components) {
                if (component !== webViewManager.getLatestWebView()?.browser?.component) {
                    contentPanel.remove(component)
                }
            }

            // Relayout
            contentPanel.revalidate()
            contentPanel.repaint()

            logger.info("System info placeholder hidden")
        }

        /**
         * Setup drag and drop support
         */
        private fun setupDragAndDropSupport(webView: WebViewInstance) {
            try {
                logger.info("Setting up drag and drop support for WebView")

                dragDropHandler = DragDropHandler(webView, contentPanel)

                dragDropHandler?.setupDragAndDrop()

                logger.info("Drag and drop support enabled")
            } catch (e: Exception) {
                logger.error("Failed to setup drag and drop support", e)
            }
        }
    }
}
