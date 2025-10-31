// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy.interfaces

/**
 * Extension host WebView views service interface
 * Corresponds to ExtHostWebviewViewsShape in VSCode
 */
interface ExtHostWebviewViewsProxy {
    /**
     * Resolve WebView view
     * @param webviewHandle WebView handle
     * @param viewType View type
     * @param title Title
     * @param state State data
     * @param cancellation Cancellation token
     * @return Promise when completed
     */
    fun resolveWebviewView(
        webviewHandle: String,
        viewType: String,
        title: String?,
        state: Any?,
        cancellation: Any?,
    )

    /**
     * Triggered when WebView view visibility changes
     * @param webviewHandle WebView handle
     * @param visible Whether visible
     */
    fun onDidChangeWebviewViewVisibility(
        webviewHandle: String,
        visible: Boolean,
    )

    /**
     * Dispose WebView view
     * @param webviewHandle WebView handle
     */
    fun disposeWebviewView(
        webviewHandle: String,
    )
}
