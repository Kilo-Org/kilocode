import { vscode } from "@src/utils/vscode"
import { OCA_MSG } from "./ocaMessages"

/**
 * Centralized helpers to post OCA-related messages to the extension.
 */

export function postOcaStatus(): void {
	vscode.postMessage({ type: OCA_MSG.STATUS })
}

export function ocaLogin(): void {
	vscode.postMessage({ type: "oca/login" })
}

export function ocaLogout(): void {
	vscode.postMessage({ type: "oca/logout" })
}

export function requestRouterModels(values?: Record<string, unknown>): void {
	if (values) {
		vscode.postMessage({ type: "requestRouterModels", values })
	} else {
		vscode.postMessage({ type: "requestRouterModels" })
	}
}
