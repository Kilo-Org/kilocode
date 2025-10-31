function getIconFromLevel(level: string): string {
	switch (level) {
		case "debug":
			return "🔵"
		case "info":
			return "🟢"
		case "warn":
			return "🟡"
		case "error":
			return "🔴"
	}
	return "X"
}

export class Logger {
	constructor(
		private filename: string,
		private includeFilename = false,
	) {}
	#formatMessage(level: string, message: string): string {
		return `${getIconFromLevel(level)} ${this.includeFilename ? `[${this.filename}] ` : ""}${message}`
	}
	debug(message: string, ...args: any[]) {
		console.debug(this.#formatMessage("debug", message), ...args)
	}
	info(message: string, ...args: any[]) {
		console.info(this.#formatMessage("info", message), ...args)
	}
	warn(message: string, ...args: any[]) {
		console.info(this.#formatMessage("warn", message), ...args)
	}
	error(message: string, ...args: any[]) {
		console.info(this.#formatMessage("error", message), ...args)
	}
}
