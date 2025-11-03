// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.actors

import ai.kilocode.jetbrains.events.WebviewViewProviderData
import ai.kilocode.jetbrains.webview.WebViewManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers

/**
 * Webview view related interface
 */
interface MainThreadWebviewViewsShape : Disposable {
    /**
     * Register Webview view provider
     * @param extension Webview extension description
     * @param viewType View type
     * @param options Option configuration
     */
    fun registerWebviewViewProvider(
        extension: Map<String, Any?>,
        viewType: String,
        options: Map<String, Any?>,
    )

    /**
     * Unregister Webview view provider
     * @param viewType View type
     */
    fun unregisterWebviewViewProvider(viewType: String)

    /**
     * Set Webview view title
     * @param handle Webview handle
     * @param value Title value
     */
    fun setWebviewViewTitle(handle: String, value: String?)

    /**
     * Set Webview view description
     * @param handle Webview handle
     * @param value Description content
     */
    fun setWebviewViewDescription(handle: String, value: String?)

    /**
     * Set Webview view badge
     * @param handle Webview handle
     * @param badge Badge information
     */
    fun setWebviewViewBadge(handle: String, badge: Map<String, Any?>?)

    /**
     * Show Webview view
     * @param handle Webview handle
     * @param preserveFocus Whether to preserve focus
     */
    fun show(handle: String, preserveFocus: Boolean)
}

class MainThreadWebviewViews(val project: Project) : MainThreadWebviewViewsShape {
    private val logger = Logger.getInstance(MainThreadWebviewViews::class.java)
    private val coroutineScope = CoroutineScope(Dispatchers.Default)

    override fun registerWebviewViewProvider(
        extension: Map<String, Any?>,
        viewType: String,
        options: Map<String, Any?>,
    ) {
        logger.info("Registering Webview view provider: viewType=$viewType, options=$options")

//         Use EventBus to send WebView view provider registration event, using IntelliJ platform compatible method
//        project.getService(ProjectEventBus::class.java).emitInApplication(
//            WebviewViewProviderRegisterEvent,
//            WebviewViewProviderData(extension, viewType, options)
//        )
        project.getService(WebViewManager::class.java).registerProvider(WebviewViewProviderData(extension, viewType, options))
    }

    override fun unregisterWebviewViewProvider(viewType: String) {
        logger.info("Unregistering Webview view provider: viewType=$viewType")
    }

    override fun setWebviewViewTitle(handle: String, value: String?) {
        logger.info("Setting Webview view title: handle=$handle, title=$value")
    }

    override fun setWebviewViewDescription(handle: String, value: String?) {
        logger.info("Setting Webview view description: handle=$handle, description=$value")
    }

    override fun setWebviewViewBadge(handle: String, badge: Map<String, Any?>?) {
        logger.info("Setting Webview view badge: handle=$handle, badge=$badge")
    }

    override fun show(handle: String, preserveFocus: Boolean) {
        logger.info("Showing Webview view: handle=$handle, preserveFocus=$preserveFocus")
    }

    override fun dispose() {
        logger.info("Disposing MainThreadWebviewViews resources")
    }
}
