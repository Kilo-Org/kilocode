// Copyright 2009-2025 Weibo, Inc.
// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import {
	ExtHostContext,
	ExtHostWebviewViewsShape,
	MainThreadWebviewViewsShape,
	WebviewExtensionDescription as ExtHostWebviewExtensionDescription,
	MainThreadWebviewsShape,
	IWebviewContentOptions,
} from "../deps/vscode/vs/workbench/api/common/extHost.protocol.js"
import { IRPCProtocol } from "../deps/vscode/vs/workbench/services/extensions/common/proxyIdentifier.js"
import { WebviewContentOptions } from "../deps/vscode/vs/workbench/contrib/webview/browser/webview.js"
import { URI } from "../deps/vscode/vs/base/common/uri.js"
import { CancellationToken } from "../deps/vscode/vs/base/common/cancellation.js"
import { VSBuffer } from "../deps/vscode/vs/base/common/buffer.js"

/**
 * A simplified webview implementation that only includes methods used by WebViewManager
 */
class SimpleWebview {
	contentOptions: WebviewContentOptions = {}

	setHtml(html: string): void {
		console.log("[SimpleWebview] Set HTML:", html)
	}

	setTitle(title: string): void {
		console.log("[SimpleWebview] Set title:", title)
	}

	postMessage(message: any, transfer?: readonly VSBuffer[]): Promise<boolean> {
		console.log("[SimpleWebview] Post message:", message)
		return Promise.resolve(true)
	}

	focus(): void {
		console.log("[SimpleWebview] Focus")
	}

	dispose(): void {
		console.log("[SimpleWebview] Dispose")
	}
}

export class WebViewManager implements MainThreadWebviewViewsShape, MainThreadWebviewsShape {
	private readonly _proxy: ExtHostWebviewViewsShape
	private readonly _webviews = new Map<string, SimpleWebview>()

	constructor(private readonly rpcProtocol: IRPCProtocol) {
		this._proxy = this.rpcProtocol.getProxy(ExtHostContext.ExtHostWebviewViews)
	}

	// MainThreadWebviewViewsShape implementation
	$registerWebviewViewProvider(
		extension: ExtHostWebviewExtensionDescription,
		viewType: string,
		options: { retainContextWhenHidden?: boolean; serializeBuffersForPostMessage: boolean },
	): void {
		console.log("Register webview view provider:", { extension, viewType, options })

		// Create a new webview instance
		const webview = new SimpleWebview()

		// Store the webview instance
		this._webviews.set(viewType, webview)

		// Generate a unique handle for this webview
		const webviewHandle = `webview-${viewType}-${Date.now()}`

		// Notify the extension host that the webview is ready
		this._proxy.$resolveWebviewView(
			webviewHandle,
			viewType,
			undefined, // title
			undefined, // state
			CancellationToken.None, // cancellation
		)
	}

	$unregisterWebviewViewProvider(viewType: string): void {
		console.log("Unregister webview view provider:", viewType)

		// Remove the webview instance
		const webview = this._webviews.get(viewType)
		if (webview) {
			webview.dispose()
			this._webviews.delete(viewType)
		}
	}

	$setWebviewViewTitle(handle: string, value: string | undefined): void {
		console.log("Set webview view title:", { handle, value })
		const webview = this._webviews.get(handle)
		if (webview) {
			webview.setTitle(value || "")
		}
	}

	$setWebviewViewDescription(handle: string, value: string | undefined): void {
		console.log("Set webview view description:", { handle, value })
	}

	$setWebviewViewBadge(handle: string, badge: any | undefined): void {
		console.log("Set webview view badge:", { handle, badge })
	}

	$show(handle: string, preserveFocus: boolean): void {
		console.log("Show webview view:", { handle, preserveFocus })
		const webview = this._webviews.get(handle)
		if (webview) {
			webview.focus()
		}
	}

	// MainThreadWebviewsShape implementation
	$setHtml(handle: string, value: string): void {
		console.log("Set webview HTML:", { handle, value })
		const webview = this._webviews.get(handle)
		if (webview) {
			webview.setHtml(value)
		}
	}

	$setOptions(handle: string, options: IWebviewContentOptions): void {
		console.log("Set webview panel options:", { handle, options })
		const webview = this._webviews.get(handle)
		if (webview) {
			// Convert IWebviewContentOptions to WebviewContentOptions
			const contentOptions: WebviewContentOptions = {
				allowScripts: options.enableScripts,
				allowForms: options.enableForms,
				localResourceRoots: options.localResourceRoots?.map((uri) => URI.revive(uri)),
				portMapping: options.portMapping,
			}
			webview.contentOptions = contentOptions
		}
	}

	$postMessage(handle: string, value: string, ...buffers: VSBuffer[]): Promise<boolean> {
		console.log("Post message to webview:", { handle, value, buffers })
		const webview = this._webviews.get(handle)
		if (webview) {
			return webview.postMessage(value, buffers)
		}
		return Promise.resolve(false)
	}

	dispose(): void {
		console.log("Dispose WebViewManager")
		// Dispose all webviews
		for (const webview of this._webviews.values()) {
			webview.dispose()
		}
		this._webviews.clear()
	}
}
