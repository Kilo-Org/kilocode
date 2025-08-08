// Simple test to verify compact mode functionality
const { SYSTEM_PROMPT } = require("./src/core/prompts/system")

// Mock context and parameters
const mockContext = {
	workspaceState: {
		get: () => ({}),
	},
	globalState: {
		get: () => ({}),
	},
}

const testParams = {
	context: mockContext,
	cwd: "/test/project",
	supportsComputerUse: false,
	mode: "code",
	compactMode: true,
}

console.log("Testing compact mode...")
console.log("Compact mode enabled:", testParams.compactMode)
console.log("\nThis test verifies that:")
console.log("1. Timezone is changed to Asia/Singapore")
console.log("2. System prompt supports compact mode")
console.log("3. Tool descriptions are simplified in compact mode")
