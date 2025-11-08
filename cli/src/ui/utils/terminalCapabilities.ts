/**
 * Terminal capability detection utilities
 * Detects support for Kitty keyboard protocol and other advanced features
 */

/**
 * Check if terminal supports Kitty protocol
 * Partially copied from gemini-cli
 */
let kittyDetected = false
let kittySupported = false
const kittyEnabled = false

export async function detectKittyProtocolSupport(): Promise<boolean> {
	if (kittyDetected) {
		return kittySupported
	}

	return new Promise((resolve) => {
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			kittyDetected = true
			resolve(false)
			return
		}

		const originalRawMode = process.stdin.isRaw
		if (!originalRawMode) {
			process.stdin.setRawMode(true)
		}

		let responseBuffer = ""
		let progressiveEnhancementReceived = false
		let timeoutId: NodeJS.Timeout | undefined

		const onTimeout = () => {
			timeoutId = undefined
			process.stdin.removeListener("data", handleData)
			if (!originalRawMode) {
				process.stdin.setRawMode(false)
			}
			kittyDetected = true
			resolve(false)
		}

		const handleData = (data: Buffer) => {
			if (timeoutId === undefined) {
				// Race condition. We have already timed out.
				return
			}
			responseBuffer += data.toString()

			// Check for progressive enhancement response (CSI ? <flags> u)
			if (responseBuffer.includes("\x1b[?") && responseBuffer.includes("u")) {
				progressiveEnhancementReceived = true
				// Give more time to get the full set of kitty responses if we have an
				// indication the terminal probably supports kitty and we just need to
				// wait a bit longer for a response.
				clearTimeout(timeoutId)
				timeoutId = setTimeout(onTimeout, 1000)
			}

			// Check for device attributes response (CSI ? <attrs> c)
			if (responseBuffer.includes("\x1b[?") && responseBuffer.includes("c")) {
				clearTimeout(timeoutId)
				timeoutId = undefined
				process.stdin.removeListener("data", handleData)

				if (!originalRawMode) {
					process.stdin.setRawMode(false)
				}

				if (progressiveEnhancementReceived) {
					kittySupported = true
				}

				kittyDetected = true
				resolve(kittySupported)
			}
		}

		process.stdin.on("data", handleData)

		// Send queries
		process.stdout.write("\x1b[?u") // Query progressive enhancement
		process.stdout.write("\x1b[c") // Query device attributes

		// Timeout after 200ms
		// When a iterm2 terminal does not have focus this can take over 90s on a
		// fast macbook so we need a somewhat longer threshold than would be ideal.
		timeoutId = setTimeout(onTimeout, 200)
	})
}

/**
 * Auto-detect and enable Kitty protocol if supported
 * Returns true if enabled, false otherwise
 */
export async function autoEnableKittyProtocol(): Promise<boolean> {
	// Query terminal for actual support
	const isSupported = await detectKittyProtocolSupport()

	if (isSupported) {
		// Enable Kitty keyboard protocol
		// CSI > 1 u - Enable disambiguate escape codes
		process.stdout.write("\x1b[>1u")
		// CSI = 1 ; 1 u - Push keyboard flags, enable disambiguate
		process.stdout.write("\x1b[=1;1u")

		process.on("exit", disableKittyProtocol)
		process.on("SIGTERM", disableKittyProtocol)
		return true
	}

	return false
}

/**
 * Disable Kitty keyboard protocol
 */
export function disableKittyProtocol(): void {
	process.stdout.write("\x1b[<u")
}
