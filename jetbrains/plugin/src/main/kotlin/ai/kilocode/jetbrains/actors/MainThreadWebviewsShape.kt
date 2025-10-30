// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.events.WebviewHtmlUpdateData
import ai.kilocode.jetbrains.webview.WebViewManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import java.util.concurrent.ConcurrentHashMap

/**
 * Webview handle type
 * Corresponds to WebviewHandle type in TypeScript
 */
typealias WebviewHandle = String

/**
 * Main thread Webviews service interface
 * Corresponds to MainThreadWebviewsShape interface in VSCode
 */
interface MainThreadWebviewsShape : Disposable {
    /**
     * Set HTML content
     * Corresponds to $setHtml method in TypeScript interface
     * @param handle Webview handle
     * @param value HTML content
     */
    fun setHtml(handle: WebviewHandle, value: String)

    /**
     * Set Webview options
     * Corresponds to $setOptions method in TypeScript interface
     * @param handle Webview handle
     * @param options Webview content options
     */
    fun setOptions(handle: WebviewHandle, options: Map<String, Any?>)

    /**
     * Send message to Webview
     * Corresponds to $postMessage method in TypeScript interface
     * @param handle Webview handle
     * @param value Message content
     * @param buffers Binary buffer array
     * @return Whether operation succeeded
     */
    fun postMessage(handle: WebviewHandle, value: String): Boolean
}

/**
 * Main thread Webviews service implementation class
 */
class MainThreadWebviews(val project: Project) : MainThreadWebviewsShape {
    private val logger = Logger.getInstance(MainThreadWebviews::class.java)

    // Store registered Webviews
    private val webviews = ConcurrentHashMap<WebviewHandle, Any?>()
    private var webviewHandle: WebviewHandle = ""

    override fun setHtml(handle: WebviewHandle, value: String) {
        logger.info("Setting Webview HTML: handle=$handle, length=${value.length}")
        webviewHandle = handle
        try {
            // Replace vscode-file protocol format, using regex to match from vscode-file:/ to /kilocode/ part
            val modifiedHtml = value.replace(Regex("vscode-file:/.*?/kilocode/"), "/")
            logger.info("Replaced vscode-file protocol path format")

            // Send HTML content update event through EventBus
            val data = WebviewHtmlUpdateData(handle, modifiedHtml)
//            project.getService(ProjectEventBus::class.java).emitInApplication(WebviewHtmlUpdateEvent, data)
            project.getService(WebViewManager::class.java).updateWebViewHtml(data)
            logger.info("Sent HTML content update event: handle=$handle")
        } catch (e: Exception) {
            logger.error("Failed to set Webview HTML", e)
        }
    }

    override fun setOptions(handle: WebviewHandle, options: Map<String, Any?>) {
        logger.info("Setting Webview options: handle=$handle, options=$options")
        webviewHandle = handle
        try {
            // Actual implementation should set options for Webview component on IDEA platform
            // Here we just log
        } catch (e: Exception) {
            logger.error("Failed to set Webview options: $e")
        }
    }

    override fun postMessage(handle: WebviewHandle, value: String): Boolean {
//        logger.info("Sending message to Webview: handle=$handle")
        if (value.contains("theme")) {
            logger.info("Sending theme message to Webview")
        }

        return try {
            val mangler = project.getService(WebViewManager::class.java)

//            mangler.getWebView(handle)?.postMessageToWebView(value)
            mangler.getLatestWebView()?.postMessageToWebView(value)
            true
        } catch (e: Exception) {
            logger.error("Failed to send message to Webview: $e")
            false
        }
    }

    override fun dispose() {
        logger.info("Disposing MainThreadWebviews resources")
        webviews.clear()
    }
}
