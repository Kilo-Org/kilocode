// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package com.sina.weibo.agent.ui

import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import com.intellij.ui.jcef.JBCefApp
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.ide.BrowserUtil
import com.sina.weibo.agent.actions.OpenDevToolsAction
import com.sina.weibo.agent.plugin.WecoderPlugin
import com.sina.weibo.agent.plugin.WecoderPluginService
import com.sina.weibo.agent.plugin.DEBUG_MODE
import com.sina.weibo.agent.webview.DragDropHandler
import com.sina.weibo.agent.webview.WebViewCreationCallback
import com.sina.weibo.agent.webview.WebViewInstance
import com.sina.weibo.agent.webview.WebViewManager
import com.sina.weibo.agent.util.PluginConstants
import java.awt.BorderLayout
import java.awt.datatransfer.StringSelection
import java.awt.Toolkit
import java.awt.Dimension
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
        if ( WecoderPluginService.getDebugMode() != DEBUG_MODE.NONE) {
            titleActions.add(OpenDevToolsAction { project.getService(WebViewManager::class.java).getLatestWebView() })
        }
        
        toolWindow.setTitleActions(titleActions)

        // webview panel
        val rooToolWindowContent = RooToolWindowContent(project, toolWindow)
        val contentFactory = ContentFactory.getInstance()
        val content = contentFactory.createContent(
            rooToolWindowContent.content,
            "",
            false
        )
        toolWindow.contentManager.addContent(content)
    }

    private class RooToolWindowContent(
        private val project: Project,
        private val toolWindow: ToolWindow
    ) : WebViewCreationCallback {
        private val logger = Logger.getInstance(RooToolWindowContent::class.java)
        
        // Get WebViewManager instance
        private val webViewManager = project.getService(WebViewManager::class.java)
        
        // Content panel
        private val contentPanel = JPanel(BorderLayout())
        
        // Placeholder label
        private val placeholderLabel = JLabel(createSystemInfoText())

        // System info text for copying
        private val systemInfoText = createSystemInfoPlainText()
        
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
            
            return buildString {
                append("<html><body style='width: 300px;'>")
                append("<p>Kilo Code is initializing...")
                append("<h3>System Information</h3>")
                append("<table>")
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
                    append("See known issues doc for more information.")
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
            
            return buildString {
                append("System Information\n")
                append("==================\n")
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
                BrowserUtil.browse("https://kilocode.ai/docs")
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
                    }
                }
                // If page is already loaded, hide system info immediately
                if (webView.isPageLoaded()) {
                    ApplicationManager.getApplication().invokeLater {
                        hideSystemInfo()
                    }
                }
            }?:webViewManager.addCreationCallback(this, toolWindow.disposable)
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
            
            // Add WebView component without removing existing components
            contentPanel.add(webView.browser.component, BorderLayout.CENTER)
            
            setupDragAndDropSupport(webView)
            
            // Relayout
            contentPanel.revalidate()
            contentPanel.repaint()
            
            logger.info("WebView component added to tool window")
        }
        
        /**
         * Hide system info placeholder
         */
        private fun hideSystemInfo() {
            logger.info("Hiding system info placeholder")
            
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