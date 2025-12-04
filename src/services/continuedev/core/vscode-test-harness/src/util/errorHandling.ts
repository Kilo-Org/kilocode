/**
 * @param error Logs LLM errors for debugging purposes
 * @returns false to allow normal error handling flow
 */
export async function handleLLMError(error: unknown): Promise<boolean> {
	if (!error || !(error instanceof Error) || !error.message) {
		return false
	}

	// Log errors for debugging but don't show interactive prompts
	const message = error.message
	if (message.toLowerCase().includes("lemonade")) {
		console.log("Lemonade error:", message)
	} else if (message.toLowerCase().includes("ollama")) {
		console.log("Ollama error:", message)
	}

	// Always return false to allow normal error handling
	return false
}
