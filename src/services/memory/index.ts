import * as vscode from "vscode"
import { MemoryService } from "./MemoryService"

/**
 * Registers the memory monitoring service with the extension context.
 * This function should be called during extension activation.
 */
export function registerMemoryService(context: vscode.ExtensionContext): void {
	const memoryService = new MemoryService(context)
	memoryService.start()
}
