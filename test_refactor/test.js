const fs = require("fs")
const path = require("path")

// Create a test JSON object that simulates the refactor_code tool input
const testInput = {
	path: "test_refactor/input/main.ts",
	operations: {
		operation: "move",
		selector: {
			type: "identifier",
			name: "DataProcessor",
			kind: "class",
			filePath: "test_refactor/input/main.ts",
		},
		targetFilePath: "test_refactor/input/processor.ts",
	},
}

// Write the test input to a file
fs.writeFileSync("test_refactor/test_input.json", JSON.stringify(testInput, null, 2))

console.log("Test file created. Now you can run the refactor_code tool with this input.")
