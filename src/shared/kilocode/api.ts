export const getKiloCodeApiUrl = () => {
	// Check for Node.js environment variable first
	if (typeof process !== "undefined" && process.env?.KILOCODE_BASE_URL) {
		return process.env.KILOCODE_BASE_URL
	}

	// Check for browser window variable
	if (typeof window !== "undefined" && (window as any).KILOCODE_BASE_URL) {
		return (window as any).KILOCODE_BASE_URL
	}

	// Default fallback
	return "https://kilocode.ai"
}
