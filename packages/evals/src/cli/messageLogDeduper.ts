export class MessageLogDeduper {
	private readonly lastLoggedByKey = new Map<string, string>()

	constructor(private readonly maxEntries = 10_000) {}

	/**
	 * Returns true if this message should be logged.
	 * Dedupe key: `${action}:${message.ts}`.
	 * Dedupe rule: skip if payload is identical to the last logged payload for that key.
	 */
	public shouldLog(action: string | undefined, message: unknown): boolean {
		if (!action || !message || typeof message !== "object") {
			return true
		}

		const ts = (message as { ts?: unknown }).ts
		if (typeof ts !== "number") {
			return true
		}

		let serialized: string
		try {
			serialized = JSON.stringify(message)
		} catch {
			// If serialization fails, prefer logging.
			return true
		}

		const key = `${action}:${ts}`
		const prev = this.lastLoggedByKey.get(key)
		if (prev === serialized) {
			return false
		}

		// Refresh insertion order so eviction removes true oldest.
		if (this.lastLoggedByKey.has(key)) {
			this.lastLoggedByKey.delete(key)
		}
		this.lastLoggedByKey.set(key, serialized)

		if (this.lastLoggedByKey.size > this.maxEntries) {
			const oldestKey = this.lastLoggedByKey.keys().next().value as string | undefined
			if (oldestKey) {
				this.lastLoggedByKey.delete(oldestKey)
			}
		}

		return true
	}
}
