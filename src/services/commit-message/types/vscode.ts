// kilocode_change - new file
import * as vscode from "vscode"

export interface VscGenerationRequest {
	inputBox: { value: string }
	rootUri?: vscode.Uri
}

export const VSCodeMessageTypeMap = {
	info: "showInformationMessage",
	error: "showErrorMessage",
	warning: "showWarningMessage",
} as const
