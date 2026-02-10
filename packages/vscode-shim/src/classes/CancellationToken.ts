/**
 * CancellationToken and CancellationTokenSource for VSCode API
 */

import { EventEmitter } from "./EventEmitter.js"
import type { Disposable } from "../interfaces/workspace.js"

/**
 * Cancellation token interface
 */
export interface CancellationToken {
	isCancellationRequested: boolean
	onCancellationRequested: (listener: (e: unknown) => void) => Disposable
}

/**
 * CancellationTokenSource creates and controls a CancellationToken
 */
export class CancellationTokenSource {
	private _token: CancellationToken
	private _isCancelled = false
	private _onCancellationRequestedEmitter = new EventEmitter<void>()

	constructor() {
		this._token = {
			isCancellationRequested: false,
			onCancellationRequested: this._onCancellationRequestedEmitter.event,
		}
	}

	get token(): CancellationToken {
		return this._token
	}

	cancel(): void {
		if (!this._isCancelled) {
			this._isCancelled = true
			// Type assertion needed to modify readonly property
			;(this._token as { isCancellationRequested: boolean }).isCancellationRequested = true
			this._onCancellationRequestedEmitter.fire(undefined)
		}
	}

	dispose(): void {
		this.cancel()
		this._onCancellationRequestedEmitter.dispose()
	}
}
