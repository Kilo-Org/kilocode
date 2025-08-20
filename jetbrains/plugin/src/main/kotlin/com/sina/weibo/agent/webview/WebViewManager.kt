// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package com.sina.weibo.agent.webview

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import com.sina.weibo.agent.core.PluginContext
import com.sina.weibo.agent.core.ServiceProxyRegistry
import com.sina.weibo.agent.events.WebviewHtmlUpdateData
import com.sina.weibo.agent.events.WebviewViewProviderData
import com.sina.weibo.agent.ipc.proxy.SerializableObjectWithBuffers
import com.sina.weibo.agent.theme.ThemeChangeListener
import com.sina.weibo.agent.theme.ThemeManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.cef.CefSettings
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.*
import org.cef.misc.BoolRef
import org.cef.network.CefRequest
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.util.*
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.pathString

/**
 * WebView creation callback interface
 */
interface WebViewCreationCallback {
    /**
     * Called when WebView is created
     * @param instance Created WebView instance
     */
    fun onWebViewCreated(instance: WebViewInstance)
}

/**
 * WebView manager, responsible for managing all WebView instances created during the plugin lifecycle
 */
@Service(Service.Level.PROJECT)
class WebViewManager(var project: Project) : Disposable, ThemeChangeListener {
    private val logger = Logger.getInstance(WebViewManager::class.java)

    // Latest created WebView instance
    @Volatile
    private var latestWebView: WebViewInstance? = null
    
    // Store WebView creation callbacks
    private val creationCallbacks = mutableListOf<WebViewCreationCallback>()

    // Resource root directory path
    @Volatile
    private var resourceRootDir: Path? = null
    
    // Current theme configuration
    private var currentThemeConfig: JsonObject? = null
    
    // Current theme type
    private var isDarkTheme: Boolean = true
    
    // Prevent repeated dispose
    private var isDisposed = false
    private var themeInitialized = false

    /**
     * Initialize theme manager
     * @param resourceRoot Resource root directory
     */
    fun initializeThemeManager(resourceRoot: String) {
        if (isDisposed or themeInitialized) return
        
        logger.info("Initialize theme manager")
        val themeManager = ThemeManager.getInstance()
        themeManager.initialize(resourceRoot)
        themeManager.addThemeChangeListener(this)
        themeInitialized = true
    }
    
    /**
     * Implement ThemeChangeListener interface, handle theme change events
     */
    override fun onThemeChanged(themeConfig: JsonObject, isDarkTheme: Boolean) {
        logger.info("Received theme change event, isDarkTheme: $isDarkTheme, config: ${themeConfig.size()}")
        this.currentThemeConfig = themeConfig
        this.isDarkTheme = isDarkTheme
        
        // Send theme config to all WebView instances
        sendThemeConfigToWebViews(themeConfig)
    }
    
    /**
     * Send theme config to all WebView instances
     */
    private fun sendThemeConfigToWebViews(themeConfig: JsonObject) {
        logger.info("Send theme config to WebView")
        
//        getAllWebViews().forEach { webView ->
            try {
                getLatestWebView()?.sendThemeConfigToWebView(themeConfig)
            } catch (e: Exception) {
                logger.error("Failed to send theme config to WebView", e)
            }
//        }
    }
    
    /**
     * Save HTML content to resource directory
     * @param html HTML content
     * @param filename File name
     * @return Saved file path
     */
    private fun saveHtmlToResourceDir(html: String, filename: String): Path? {
        if( resourceRootDir == null || !resourceRootDir!!.exists() ) {
            logger.warn("Resource root directory does not exist, cannot save HTML content")
            throw IOException("Resource root directory does not exist")
        }
        
        val filePath = resourceRootDir?.resolve(filename)
        
        try {
            if (filePath != null) {
                logger.info("HTML content saved to: $filePath")
                Files.write(filePath, html.toByteArray(StandardCharsets.UTF_8))
                return filePath
            }
            return null
        } catch (e: Exception) {
            logger.error("Failed to save HTML content: $filePath", e)
            throw e
        }
    }
    
    /**
     * Register WebView creation callback
     * @param callback Callback object
     * @param disposable Associated Disposable object, used for automatic callback removal
     */
    fun addCreationCallback(callback: WebViewCreationCallback, disposable: Disposable? = null) {
        synchronized(creationCallbacks) {
            creationCallbacks.add(callback)
            
            // If Disposable is provided, automatically remove callback when disposed
            if (disposable != null) {
                Disposer.register(disposable, Disposable {
                    removeCreationCallback(callback)
                })
            }
        }
        
        // If there is already a latest created WebView, notify immediately
        latestWebView?.let { webview ->
            ApplicationManager.getApplication().invokeLater {
                callback.onWebViewCreated(webview)
            }
        }
    }
    
    /**
     * Remove WebView creation callback
     * @param callback Callback object to remove
     */
    fun removeCreationCallback(callback: WebViewCreationCallback) {
        synchronized(creationCallbacks) {
            creationCallbacks.remove(callback)
        }
    }
    
    /**
     * Notify all callbacks that WebView has been created
     * @param instance Created WebView instance
     */
    private fun notifyWebViewCreated(instance: WebViewInstance) {
        val callbacks = synchronized(creationCallbacks) {
            creationCallbacks.toList() // Create a copy to avoid concurrent modification
        }
        
        // Safely call callbacks in UI thread
        ApplicationManager.getApplication().invokeLater {
            callbacks.forEach { callback ->
                try {
                    callback.onWebViewCreated(instance)
                } catch (e: Exception) {
                    logger.error("Exception occurred when calling WebView creation callback", e)
                }
            }
        }
    }
    
    /**
     * Register WebView provider and create WebView instance
     */
    fun registerProvider(data: WebviewViewProviderData) {
        logger.info("Register WebView provider and create WebView instance: ${data.viewType}")
        val extension = data.extension
        
        // Get location info from extension and set resource root directory
        try {
            @Suppress("UNCHECKED_CAST")
            val location = extension?.get("location") as? Map<String, Any?>
            val fsPath = location?.get("fsPath") as? String
            
            if (fsPath != null) {
                // Set resource root directory
                val path = Paths.get(fsPath)
                logger.info("Get resource directory path from extension: $path")
                
                // Ensure the resource directory exists
                if (!path.exists()) {
                    path.createDirectories()
                }
                
                 // Update resource root directory
                resourceRootDir = path
                
                // Initialize theme manager
                initializeThemeManager(fsPath)

            }
        } catch (e: Exception) {
            logger.error("Failed to get resource directory from extension", e)
        }

        val protocol = project.getService(PluginContext::class.java).getRPCProtocol()
        if (protocol == null) {
            logger.error("Cannot get RPC protocol instance, cannot register WebView provider: ${data.viewType}")
            return
        }
        // When registration event is notified, create a new WebView instance
        val viewId = UUID.randomUUID().toString()

        val title = data.options["title"] as? String ?: data.viewType
        val state = data.options["state"] as? Map<String, Any?> ?: emptyMap()
        
        val webview = WebViewInstance(data.viewType, viewId, title, state,project,data.extension)

        val proxy = protocol.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostWebviewViews)
        proxy.resolveWebviewView(viewId, data.viewType, title, state, null)


        // Set as the latest created WebView
        latestWebView = webview
        
        logger.info("Create WebView instance: viewType=${data.viewType}, viewId=$viewId")

        // Notify callback
        notifyWebViewCreated(webview)
    }
    
    /**
         * Get the latest created WebView instance
         */
    fun getLatestWebView(): WebViewInstance? {
        return latestWebView
    }

    /**
         * Update the HTML content of the WebView
         * @param data HTML update data
         */
    fun updateWebViewHtml(data: WebviewHtmlUpdateData) {
        val encodedState = getLatestWebView()?.state.toString().replace("\"", "\\\"")
        val mRst = """<script\s+nonce="([A-Za-z0-9]{32})">""".toRegex().find(data.htmlContent)
        val str = mRst?.value ?: ""
        data.htmlContent = data.htmlContent.replace(str,"""
                        ${str}
                        // First define the function to send messages
                        window.sendMessageToPlugin = function(message) {
                            // Convert JS object to JSON string
                            // console.log("sendMessageToPlugin: ", message);
                            const msgStr = JSON.stringify(message);
                            ${getLatestWebView()?.jsQuery?.inject("msgStr")}
                        };
                        
                        // Inject VSCode API mock
                        globalThis.acquireVsCodeApi = (function() {
                            let acquired = false;
                        
                            let state = JSON.parse('${encodedState}');
                        
                            if (typeof window !== "undefined" && !window.receiveMessageFromPlugin) {
                                console.log("VSCodeAPIWrapper: Setting up receiveMessageFromPlugin for IDEA plugin compatibility");
                                window.receiveMessageFromPlugin = (message) => {
                                    // console.log("receiveMessageFromPlugin received message:", JSON.stringify(message));
                                    // Create a new MessageEvent and dispatch it to maintain compatibility with existing code
                                    const event = new MessageEvent("message", {
                                        data: message,
                                    });
                                    window.dispatchEvent(event);
                                };
                            }
                        
                            return () => {
                                if (acquired) {
                                    throw new Error('An instance of the VS Code API has already been acquired');
                                }
                                acquired = true;
                                return Object.freeze({
                                    postMessage: function(message, transfer) {
                                        // console.log("postMessage: ", message);
                                        window.sendMessageToPlugin(message);
                                    },
                                    setState: function(newState) {
                                        state = newState;
                                        window.sendMessageToPlugin(newState);
                                        return newState;
                                    },
                                    getState: function() {
                                        return state;
                                    }
                                });
                            };
                        })();
                        
                        // Clean up references to window parent for security
                        delete window.parent;
                        delete window.top;
                        delete window.frameElement;
                        
                        console.log("VSCode API mock injected");
                        """)



        logger.info("Received HTML update event: handle=${data.handle}, html length: ${data.htmlContent.length}")
        
        val webView = getLatestWebView()
        
        if (webView != null) {
            try {
                // If HTTP server is running
                if ( resourceRootDir != null) {
                    // Generate unique file name for WebView
                    val filename = "index.html"

                    // Save HTML content to file
                    saveHtmlToResourceDir(data.htmlContent, filename)

                    // Use HTTP URL to load WebView content
                    val url = "http://localhost:12345/$filename"
                    logger.info("Load WebView HTML content via HTTP: $url")

                    webView.loadUrl(url)
                } else {
                    // Fallback to direct HTML loading
                    logger.warn("HTTP server not running or resource directory not set, loading HTML content directly")
                    webView.loadHtml(data.htmlContent)
                }

                    logger.info("WebView HTML content updated: handle=${data.handle}")

                // If there is already a theme config, send it after content is loaded
                if (currentThemeConfig != null) {
                    // Delay sending theme config to ensure HTML is loaded
                    ApplicationManager.getApplication().invokeLater {
                        try {
                            webView.sendThemeConfigToWebView(currentThemeConfig!!)
                        } catch (e: Exception) {
                            logger.error("Failed to send theme config to WebView", e)
                        }
                    }
                }
            } catch (e: Exception) {
                logger.error("Failed to update WebView HTML content", e)
                // Fallback to direct HTML loading
                webView.loadHtml(data.htmlContent)
            }
        } else {
            logger.warn("WebView instance not found: handle=${data.handle}")
        }
    }

    
    override fun dispose() {
        if (isDisposed) {
            logger.info("WebViewManager has already been disposed, ignoring repeated call")
            return
        }
        isDisposed = true
        
        logger.info("Releasing WebViewManager resources...")

        // Remove listener from theme manager
        try {
            ThemeManager.getInstance().removeThemeChangeListener(this)
        } catch (e: Exception) {
            logger.error("Failed to remove listener from theme manager", e)
        }
        
        // Clean up resource directory
        try {
            // Only delete index.html file, keep other files
            resourceRootDir?.let {
                val indexFile = it.resolve("index.html").toFile()
                if (indexFile.exists() && indexFile.isFile) {
                    val deleted = indexFile.delete()
                    if (deleted) {
                        logger.info("index.html file deleted")
                    } else {
                        logger.warn("Failed to delete index.html file")
                    }
                } else {
                    logger.info("index.html file does not exist, no need to clean up")
                }
            }
            resourceRootDir = null
        } catch (e: Exception) {
            logger.error("Failed to clean up index.html file", e)
        }

        try {
            latestWebView?.dispose()
        } catch (e: Exception) {
            logger.error("Failed to release WebView resources", e)
        }
        
        // Reset theme data
        currentThemeConfig = null
        
        // Clear callback list
        synchronized(creationCallbacks) {
            creationCallbacks.clear()
        }
        
        logger.info("WebViewManager released")
    }


}

/**
 * WebView instance class, encapsulates JCEF browser
 */
class WebViewInstance(
    val viewType: String,
    val viewId: String,
    val title: String,
    val state: Map<String, Any?>,
    val project: Project,
    val extension: Map<String, Any?>
) : Disposable {
    private val logger = Logger.getInstance(WebViewInstance::class.java)
    
    // JCEF browser instance
    val browser = JBCefBrowser.createBuilder().setOffScreenRendering(true).build()
    
    // WebView state
    private var isDisposed = false

    // JavaScript query handler for communication with webview
    var jsQuery: JBCefJSQuery? = null

    // JSON serialization
    private val gson = Gson()

    // Coroutine scope
    private val coroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var isPageLoaded = false

    private var currentThemeConfig: JsonObject? = null
    
    // Callback for page load completion
    private var pageLoadCallback: (() -> Unit)? = null
    
    init {
        setupJSBridge()
        // Enable resource loading interception
        enableResourceInterception(extension)
    }

    /**
     * Send theme config to the specified WebView instance
     */
    fun sendThemeConfigToWebView(themeConfig: JsonObject) {
        currentThemeConfig = themeConfig
        if(isDisposed or !isPageLoaded) {
            logger.warn("WebView has been disposed or not loaded, cannot send theme config:${isDisposed},${isPageLoaded}")
            return
        }
        injectTheme()
    }

    /**
     * Check if page is loaded
     * @return true if page is loaded, false otherwise
     */
    fun isPageLoaded(): Boolean {
        return isPageLoaded
    }
    
    /**
     * Set callback for page load completion
     * @param callback Callback function to be called when page is loaded
     */
    fun setPageLoadCallback(callback: (() -> Unit)?) {
        pageLoadCallback = callback
    }
    
    private fun injectTheme() {
        if(currentThemeConfig == null) {
            return
        }
        try {
            var cssContent: String? = null

            // Get cssContent from themeConfig and save, then remove from object
            if (currentThemeConfig!!.has("cssContent")) {
                cssContent = currentThemeConfig!!.get("cssContent").asString
                // Create a copy of themeConfig to modify without affecting the original object
                val themeConfigCopy = currentThemeConfig!!.deepCopy()
                // Remove cssContent property from the copy
                themeConfigCopy.remove("cssContent")

                // Inject CSS variables into WebView
                if (cssContent != null) {
                    val injectThemeScript = """
                        (function() {
                            console.log("Ready to inject CSS variables into WebView")
                            function injectCSSVariables() {
                                if(document.documentElement) {
                                    // Convert cssContent to style attribute of html tag
                                    try {
                                        // Extract CSS variables (format: --name:value;)
                                        const cssLines = `$cssContent`.split('\n');
                                        const cssVariables = [];
                                        
                                        // Process each line, extract CSS variable declarations
                                        for (const line of cssLines) {
                                            const trimmedLine = line.trim();
                                            // Skip comments and empty lines
                                            if (trimmedLine.startsWith('/*') || trimmedLine.startsWith('*') || trimmedLine.startsWith('*/') || trimmedLine === '') {
                                                continue;
                                            }
                                            // Extract CSS variable part
                                            if (trimmedLine.startsWith('--')) {
                                                cssVariables.push(trimmedLine);
                                            }
                                        }
                                        
                                        // Merge extracted CSS variables into style attribute string
                                        const styleAttrValue = cssVariables.join(' ');
                                        
                                        // Set as style attribute of html tag
                                        document.documentElement.setAttribute('style', styleAttrValue);
                                        console.log("CSS variables set as style attribute of HTML tag");
                                    } catch (error) {
                                        console.error("Error processing CSS variables:", error);
                                    }
                                    
                                    // Keep original default style injection logic
                                    if(document.head) {
                                        // Inject default theme style into head, use id="_defaultStyles"
                                        let defaultStylesElement = document.getElementById('_defaultStyles');
                                        if (!defaultStylesElement) {
                                            defaultStylesElement = document.createElement('style');
                                            defaultStylesElement.id = '_defaultStyles';
                                            document.head.appendChild(defaultStylesElement);
                                        }
                                        
                                        // Add default_themes.css content
                                        defaultStylesElement.textContent = `
                                            html {
                                                scrollbar-color: var(--vscode-scrollbarSlider-background) var(--vscode-editor-background);
                                            }
                                            
                                            body {
                                                overscroll-behavior-x: none;
                                                background-color: transparent;
                                                color: var(--vscode-editor-foreground);
                                                font-family: var(--vscode-font-family);
                                                font-weight: var(--vscode-font-weight);
                                                font-size: var(--vscode-font-size);
                                                margin: 0;
                                                padding: 0 20px;
                                            }
                                            
                                            img, video {
                                                max-width: 100%;
                                                max-height: 100%;
                                            }
                                            
                                            a, a code {
                                                color: var(--vscode-textLink-foreground);
                                            }
                                            
                                            p > a {
                                                text-decoration: var(--text-link-decoration);
                                            }
                                            
                                            a:hover {
                                                color: var(--vscode-textLink-activeForeground);
                                            }
                                            
                                            a:focus,
                                            input:focus,
                                            select:focus,
                                            textarea:focus {
                                                outline: 1px solid -webkit-focus-ring-color;
                                                outline-offset: -1px;
                                            }
                                            
                                            code {
                                                font-family: var(--monaco-monospace-font);
                                                color: var(--vscode-textPreformat-foreground);
                                                background-color: var(--vscode-textPreformat-background);
                                                padding: 1px 3px;
                                                border-radius: 4px;
                                            }
                                            
                                            pre code {
                                                padding: 0;
                                            }
                                            
                                            blockquote {
                                                background: var(--vscode-textBlockQuote-background);
                                                border-color: var(--vscode-textBlockQuote-border);
                                            }
                                            
                                            kbd {
                                                background-color: var(--vscode-keybindingLabel-background);
                                                color: var(--vscode-keybindingLabel-foreground);
                                                border-style: solid;
                                                border-width: 1px;
                                                border-radius: 3px;
                                                border-color: var(--vscode-keybindingLabel-border);
                                                border-bottom-color: var(--vscode-keybindingLabel-bottomBorder);
                                                box-shadow: inset 0 -1px 0 var(--vscode-widget-shadow);
                                                vertical-align: middle;
                                                padding: 1px 3px;
                                            }
                                            
                                            ::-webkit-scrollbar {
                                                width: 10px;
                                                height: 10px;
                                            }
                                            
                                            ::-webkit-scrollbar-corner {
                                                background-color: var(--vscode-editor-background);
                                            }
                                            
                                            ::-webkit-scrollbar-thumb {
                                                background-color: var(--vscode-scrollbarSlider-background);
                                            }
                                            ::-webkit-scrollbar-thumb:hover {
                                                background-color: var(--vscode-scrollbarSlider-hoverBackground);
                                            }
                                            ::-webkit-scrollbar-thumb:active {
                                                background-color: var(--vscode-scrollbarSlider-activeBackground);
                                            }
                                            ::highlight(find-highlight) {
                                                background-color: var(--vscode-editor-findMatchHighlightBackground);
                                            }
                                            ::highlight(current-find-highlight) {
                                                background-color: var(--vscode-editor-findMatchBackground);
                                            }
                                        `;
                                        console.log("Default style injected to id=_defaultStyles");
                                    }
                                } else {
                                    // If html tag does not exist yet, wait for DOM to load and try again
                                    setTimeout(injectCSSVariables, 10);
                                }
                            }
                            // If document is already loaded
                            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                                console.log("Document loaded, inject CSS variables immediately");
                                injectCSSVariables();
                            } else {
                                // Otherwise wait for DOMContentLoaded event
                                console.log("Document not loaded, waiting for DOMContentLoaded event");
                                document.addEventListener('DOMContentLoaded', injectCSSVariables);
                            }
                        })()
                    """.trimIndent()

                    logger.info("Injecting theme style into WebView(${viewId}), size: ${cssContent.length} bytes")
                    executeJavaScript(injectThemeScript)
                }

                // Pass the theme config without cssContent via message
                val themeConfigJson = gson.toJson(themeConfigCopy)
                val message = """
                    {
                        "type": "theme",
                        "text": "${themeConfigJson.replace("\"", "\\\"")}"
                    }
                """.trimIndent()

                postMessageToWebView(message)
                logger.info("Theme config without cssContent has been sent to WebView")
            } else {
                // If there is no cssContent, send the original config directly
                val themeConfigJson = gson.toJson(currentThemeConfig)
                val message = """
                    {
                        "type": "theme",
                        "text": "${themeConfigJson.replace("\"", "\\\"")}"
                    }
                """.trimIndent()

                postMessageToWebView(message)
                logger.info("Theme config has been sent to WebView")
            }
        } catch (e: Exception) {
            logger.error("Failed to send theme config to WebView", e)
        }
    }

    private fun setupJSBridge() {
        // Create JS query object to handle messages from webview
        jsQuery = JBCefJSQuery.create(browser)

        // Set callback for receiving messages from webview
        jsQuery?.addHandler { message ->
            coroutineScope.launch {
                // Handle message
                val protocol = project.getService(PluginContext::class.java).getRPCProtocol()
                if (protocol != null) {
                    // Send message to plugin host
                    val serializeParam = SerializableObjectWithBuffers(emptyList<ByteArray>())
                    protocol.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostWebviews).onMessage(viewId, message, serializeParam)
                } else {
                    logger.error("Cannot get RPC protocol instance, cannot handle message: $message")
                }
            }
            null // No return value needed
        }
    }

    /**
         * Send message to WebView
         * @param message Message to send (JSON string)
         */
    fun postMessageToWebView(message: String) {
        if (!isDisposed) {
            // Send message to WebView via JavaScript function
            val script = """
                if (window.receiveMessageFromPlugin) {
                    window.receiveMessageFromPlugin($message);
                } else {
                    console.warn("receiveMessageFromPlugin not available");
                }
            """.trimIndent()
            executeJavaScript(script)
        }
    }

    /**
         * Enable resource request interception
         */
    fun enableResourceInterception(extension: Map<String, Any?>) {
        try {
            @Suppress("UNCHECKED_CAST")
            val location = extension?.get("location") as? Map<String, Any?>
            val fsPath = location?.get("fsPath") as? String

            // Get JCEF client
            val client = browser.jbCefClient

            // Register console message handler
            client.addDisplayHandler(object: CefDisplayHandlerAdapter() {
                override fun onConsoleMessage(
                    browser: CefBrowser?,
                    level: CefSettings.LogSeverity?,
                    message: String?,
                    source: String?,
                    line: Int
                ): Boolean {
                    logger.info("WebView console message: [$level] $message (line: $line, source: $source)")
                    return true
                }
            }, browser.cefBrowser)
            
            // Register load handler
            client.addLoadHandler(object : CefLoadHandlerAdapter() {
                override fun onLoadingStateChange(
                    browser: CefBrowser?,
                    isLoading: Boolean,
                    canGoBack: Boolean,
                    canGoForward: Boolean
                ) {
                    logger.info("WebView loading state changed: isLoading=$isLoading, canGoBack=$canGoBack, canGoForward=$canGoForward")
                }
                
                override fun onLoadStart(
                    browser: CefBrowser?,
                    frame: CefFrame?,
                    transitionType: CefRequest.TransitionType?
                ) {
                    logger.info("WebView started loading: ${frame?.url}, transition type: $transitionType")
                    isPageLoaded = false
                }
                
                override fun onLoadEnd(
                    browser: CefBrowser?,
                    frame: CefFrame?,
                    httpStatusCode: Int
                ) {
                    logger.info("WebView finished loading: ${frame?.url}, status code: $httpStatusCode")
                    isPageLoaded = true
                    injectTheme()
                    // Notify page load completion
                    pageLoadCallback?.invoke()
                }
                
                override fun onLoadError(
                    browser: CefBrowser?,
                    frame: CefFrame?,
                    errorCode: CefLoadHandler.ErrorCode?,
                    errorText: String?,
                    failedUrl: String?
                ) {
                    logger.info("WebView load error: $failedUrl, error code: $errorCode, error message: $errorText")
                }
            }, browser.cefBrowser)
            client.addRequestHandler(object : CefRequestHandlerAdapter() {
                override fun onBeforeBrowse(
                    browser: CefBrowser?,
                    frame: CefFrame?,
                    request: CefRequest?,
                    user_gesture: Boolean,
                    is_redirect: Boolean
                ): Boolean {
                    logger.info("onBeforeBrowse,url:${request?.url}")
                    if(request?.url?.startsWith("http://localhost") == false){
                        BrowserUtil.browse(request.url)
                        return true
                    }
                    return false
                }

                override fun getResourceRequestHandler(
                    browser: CefBrowser?,
                    frame: CefFrame?,
                    request: CefRequest?,
                    isNavigation: Boolean,
                    isDownload: Boolean,
                    requestInitiator: String?,
                    disableDefaultHandling: BoolRef?
                ): CefResourceRequestHandler? {
                    logger.info("getResourceRequestHandler,fsPath:${fsPath}")
                    if (fsPath != null && request?.url?.contains("localhost")==true) {
                        // Set resource root directory
                        val path = Paths.get(fsPath)
                        return LocalResHandler(path.pathString,request)
                    }else{
                        return null
                    }

                }
            }, browser.cefBrowser)
            logger.info("WebView resource interception enabled: $viewType/$viewId")
        } catch (e: Exception) {
            logger.error("Failed to enable WebView resource interception", e)
        }
    }
    
    /**
         * Load URL
         */
    fun loadUrl(url: String) {
        if (!isDisposed) {
            logger.info("WebView loading URL: $url")
            browser.loadURL(url)
        }
    }
    
    /**
         * Load HTML content
         */
    fun loadHtml(html: String, baseUrl: String? = null) {
        if (!isDisposed) {
            logger.info("WebView loading HTML content, length: ${html.length}, baseUrl: $baseUrl")
            if(baseUrl != null) {
                browser.loadHTML(html, baseUrl)
            }else {
                browser.loadHTML(html)
            }
        }
    }
    
    /**
         * Execute JavaScript
         */
    fun executeJavaScript(script: String) {
        if (!isDisposed) {
            logger.info("WebView executing JavaScript, script length: ${script.length}")
            browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
        }
    }
    
    /**
         * Open developer tools
         */
    fun openDevTools() {
        if (!isDisposed) {
            browser.openDevtools()
        }
    }
    
    override fun dispose() {
        if (!isDisposed) {
            browser.dispose()
            isDisposed = true
            logger.info("WebView instance released: $viewType/$viewId")
        }
    }
}