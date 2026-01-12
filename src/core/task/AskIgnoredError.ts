/**
 * Error thrown when an ask promise is superseded by a newer one.
 *
 * This is used as an internal control flow signal - not an actual error.
 * It occurs when multiple asks are sent in rapid succession and an older
 * ask is invalidated by a newer one (e.g., during streaming updates).
 */
export class AskIgnoredError extends Error {
	constructor(reason?: string) {
		super(reason ? `Ask ignored: ${reason}` : "Ask ignored")
		this.name = "AskIgnoredError"
		// Maintains proper prototype chain for instanceof checks
		Object.setPrototypeOf(this, AskIgnoredError.prototype)
	}
}
