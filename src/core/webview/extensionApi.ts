import * as vscode from "vscode"
import { ClineProvider } from "./ClineProvider"

export function registerAgenticaProvider(context: vscode.ExtensionContext): ClineProvider {
    const provider = new ClineProvider(context)
    
    // Register the webview provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("agenticaProvider", provider)
    )
    
    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand("agentica.login", async () => {
            // Trigger login flow
            await provider.sendMessageToWebview({
                type: "agentica.login.triggered",
                data: {}
            })
        }),
        
        vscode.commands.registerCommand("agentica.upgrade", async () => {
            // Trigger upgrade flow
            await provider.sendMessageToWebview({
                type: "agentica.upgrade.triggered",
                data: {}
            })
        }),
        
        vscode.commands.registerCommand("agentica.logout", async () => {
            // Trigger logout flow
            await provider.sendMessageToWebview({
                type: "agentica.logout.triggered",
                data: {}
            })
        })
    )
    
    return provider
}