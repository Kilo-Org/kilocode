import * as vscode from "vscode"
import { ExtensionMessage } from "../../shared/ExtensionMessage"
import { WebviewMessage } from "../../shared/WebviewMessage"
import { AgenticaService } from "../services/agentica/AgenticaService"
import { AgenticaMessages } from "./messages/AgenticaMessages"

export class ClineProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView
    private _agenticaService: AgenticaService

    constructor(private readonly _context: vscode.ExtensionContext) {
        this._agenticaService = new AgenticaService(_context)
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri]
        }

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)
        this._setWebviewMessageListener(webviewView.webview)
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Agentica Provider</title>
            </head>
            <body>
                <div id="root"></div>
                <script>
                    const vscode = acquireVsCodeApi();
                    window.vscode = vscode;
                </script>
            </body>
            </html>
        `
    }

    private _setWebviewMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(
            async (message: WebviewMessage) => {
                switch (message.type) {
                    case AgenticaMessages.LOGIN_REQUEST:
                        try {
                            const result = await this._agenticaService.login(message.data)
                            webview.postMessage({
                                type: AgenticaMessages.LOGIN_RESPONSE,
                                data: result
                            })
                        } catch (error) {
                            webview.postMessage({
                                type: AgenticaMessages.LOGIN_RESPONSE,
                                error: error.message
                            })
                        }
                        break
                    
                    case AgenticaMessages.UPGRADE_REQUEST:
                        try {
                            const result = await this._agenticaService.upgrade(message.data)
                            webview.postMessage({
                                type: AgenticaMessages.UPGRADE_RESPONSE,
                                data: result
                            })
                        } catch (error) {
                            webview.postMessage({
                                type: AgenticaMessages.UPGRADE_RESPONSE,
                                error: error.message
                            })
                        }
                        break
                    
                    case AgenticaMessages.GET_STATUS:
                        try {
                            const status = await this._agenticaService.getStatus()
                            webview.postMessage({
                                type: AgenticaMessages.STATUS_RESPONSE,
                                data: status
                            })
                        } catch (error) {
                            webview.postMessage({
                                type: AgenticaMessages.STATUS_RESPONSE,
                                error: error.message
                            })
                        }
                        break
                }
            },
            undefined,
            this._context.subscriptions
        )
    }

    public async sendMessageToWebview(message: ExtensionMessage) {
        if (this._view) {
            this._view.webview.postMessage(message)
        }
    }
}
