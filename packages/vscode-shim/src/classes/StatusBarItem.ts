/**
 * StatusBarItem class for VSCode API
 */

import { StatusBarAlignment } from "../types.js"
import type { Disposable } from "../interfaces/workspace.js"

/**
 * Status bar item mock for CLI mode
 */
export class StatusBarItem implements Disposable {
	private _text: string = ""
	private _tooltip: string | undefined
	private _command: string | undefined
	private _color: string | undefined
	private _backgroundColor: string | undefined
	private _isVisible: boolean = false

	constructor(
		public readonly alignment: StatusBarAlignment,
		public readonly priority?: number,
	) {}

	get text(): string {
		return this._text
	}

	set text(value: string) {
		this._text = value
	}

	get tooltip(): string | undefined {
		return this._tooltip
	}

	set tooltip(value: string | undefined) {
		this._tooltip = value
	}

	get command(): string | undefined {
		return this._command
	}

	set command(value: string | undefined) {
		this._command = value
	}

	get color(): string | undefined {
		return this._color
	}

	set color(value: string | undefined) {
		this._color = value
	}

	get backgroundColor(): string | undefined {
		return this._backgroundColor
	}

	set backgroundColor(value: string | undefined) {
		this._backgroundColor = value
	}

	get isVisible(): boolean {
		return this._isVisible
	}

	show(): void {
		this._isVisible = true
	}

	hide(): void {
		this._isVisible = false
	}

	dispose(): void {
		this._isVisible = false
	}
}
