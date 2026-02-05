import * as vscode from 'vscode';
import { KiloProvider } from './KiloProvider';
import { AgentManagerProvider } from './AgentManagerProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log('Kilo Code extension is now active');

	// Create the provider with extensionUri and context
	const provider = new KiloProvider(context.extensionUri, context);

	// Register the webview view provider for the sidebar
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(KiloProvider.viewType, provider)
	);

	// Create Agent Manager provider for editor panel
	const agentManagerProvider = new AgentManagerProvider(context.extensionUri);
	context.subscriptions.push(agentManagerProvider);

	// Register toolbar button command handlers
	context.subscriptions.push(
		vscode.commands.registerCommand('kilo-code.new.plusButtonClicked', () => {
			provider.postMessage({ type: 'action', action: 'plusButtonClicked' });
		}),
		vscode.commands.registerCommand('kilo-code.new.agentManagerOpen', () => {
			agentManagerProvider.openPanel();
		}),
		vscode.commands.registerCommand('kilo-code.new.marketplaceButtonClicked', () => {
			provider.postMessage({ type: 'action', action: 'marketplaceButtonClicked' });
		}),
		vscode.commands.registerCommand('kilo-code.new.historyButtonClicked', () => {
			provider.postMessage({ type: 'action', action: 'historyButtonClicked' });
		}),
		vscode.commands.registerCommand('kilo-code.new.profileButtonClicked', () => {
			provider.postMessage({ type: 'action', action: 'profileButtonClicked' });
		}),
		vscode.commands.registerCommand('kilo-code.new.settingsButtonClicked', () => {
			provider.postMessage({ type: 'action', action: 'settingsButtonClicked' });
		})
	);

	// Add dispose handler to subscriptions
	context.subscriptions.push({
		dispose: () => provider.dispose()
	});
}

export function deactivate() {}
