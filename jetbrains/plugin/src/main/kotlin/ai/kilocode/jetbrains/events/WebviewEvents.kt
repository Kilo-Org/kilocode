// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.events

/**
 * WebView view provider registration event type
 */
object WebviewViewProviderRegisterEvent : EventType<WebviewViewProviderData>

/**
 * WebView view provider data
 */
data class WebviewViewProviderData(
    val extension: Map<String, Any?>,
    val viewType: String,
    val options: Map<String, Any?>,
)

/**
 * WebView HTML content update event type
 */
object WebviewHtmlUpdateEvent : EventType<WebviewHtmlUpdateData>

/**
 * WebView HTML content update data
 */
data class WebviewHtmlUpdateData(
    val handle: String,
    var htmlContent: String,
)
