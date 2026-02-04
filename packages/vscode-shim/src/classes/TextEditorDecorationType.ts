/**
 * TextEditorDecorationType class for VSCode API
 */

import type { Disposable } from "../interfaces/workspace.js"

/**
 * Text editor decoration type mock for CLI mode
 */
export class TextEditorDecorationType implements Disposable {
	public key: string

	constructor(key: string) {
		this.key = key
	}

	dispose(): void {
		// No-op for CLI
	}
}
