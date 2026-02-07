/**
 * OutputChannel class for VSCode API
 */

import { logs } from "../utils/logger.js"
import type { Disposable } from "../interfaces/workspace.js"

/**
 * Output channel mock for CLI mode
 * Logs output to the configured logger instead of VSCode's output panel
 */
export class OutputChannel implements Disposable {
	private _name: string

	constructor(name: string) {
		this._name = name
	}

	get name(): string {
		return this._name
	}

	append(value: string): void {
		logs.info(`[${this._name}] ${value}`, "VSCode.OutputChannel")
	}

	appendLine(value: string): void {
		logs.info(`[${this._name}] ${value}`, "VSCode.OutputChannel")
	}

	clear(): void {
		// No-op for CLI
	}

	show(): void {
		// No-op for CLI
	}

	hide(): void {
		// No-op for CLI
	}

	dispose(): void {
		// No-op for CLI
	}
}
