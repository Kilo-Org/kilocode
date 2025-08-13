import * as vscode from "vscode"

export async function migrateBigModelProvider(
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	const state = context.globalState
	if (state.get("apiProvider") === "bigmodel") {
		outputChannel.appendLine("Migrating removed Big Model API provider to Z.AI API provider.")
		await state.update("apiProvider", "zai")
	}
}
