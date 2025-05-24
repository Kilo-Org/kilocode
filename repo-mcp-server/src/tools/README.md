# Adding New Tools to the MCP Server

This guide explains how to add new tools to the MCP server. The server is designed with a modular architecture that makes it easy to extend with new tool categories and capabilities.

## Architecture Overview

Tools are organized by category in the `tools` directory:

```
tools/
├── index.ts        # Main entry point for all tools
├── types.ts        # Common type definitions
├── README.md       # This documentation
└── i18n/           # i18n category tools
    ├── index.ts    # Exports all i18n tools
    ├── translateKey.ts
    ├── moveKey.ts
    └── listLocales.ts
```

Each tool is implemented as a separate file that exports a tool handler class. These tool handlers are then collected in category-specific index files and ultimately exported from the main `tools/index.ts` file.

## Step 1: Create a New Tool Handler

Create a new file in the appropriate category directory (or create a new category directory if needed). Each tool should implement the `ToolHandler` interface defined in `tools/types.ts`.

Here's a template for a new tool:

```typescript
import { Context, McpToolCallResponse, ToolHandler } from "../types.js"

/**
 * My new tool handler
 */
class MyNewTool implements ToolHandler {
	name = "my_new_tool"
	description = "Description of what my tool does"
	inputSchema = {
		type: "object",
		properties: {
			param1: {
				type: "string",
				description: "Description of parameter 1",
			},
			param2: {
				type: "number",
				description: "Description of parameter 2",
			},
		},
		required: ["param1"],
	}

	async execute(args: any, context: Context): Promise<McpToolCallResponse> {
		console.error("🔍 DEBUG: Tool request received with args:", JSON.stringify(args, null, 2))

		const { param1, param2 = 0 } = args

		try {
			// Implement your tool logic here
			const result = `Processed ${param1} with value ${param2}`

			return {
				content: [
					{
						type: "text",
						text: result,
					},
				],
			}
		} catch (error) {
			console.error(`❌ ERROR in MyNewTool:`, error)
			return {
				content: [
					{
						type: "text",
						text: `Error: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
				isError: true,
			}
		}
	}
}

export default new MyNewTool()
```

## Step 2: Add Your Tool to the Category Index

If you're adding a tool to an existing category, update the category's index.ts file to include your new tool.

For example, if you added a new i18n tool, update `tools/i18n/index.ts`:

```typescript
import translateKey from "./translateKey.js"
import moveKey from "./moveKey.js"
import listLocales from "./listLocales.js"
import myNewTool from "./myNewTool.js"

// Export all i18n tools
export const i18nTools = [
	translateKey,
	moveKey,
	listLocales,
	myNewTool, // Add your new tool here
]
```

## Step 3: Create a New Category (if needed)

If you're creating a new category of tools, create a new directory in the `tools` directory and add an `index.ts` file:

```typescript
import myNewTool from "./myNewTool.js"

// Export all tools in this category
export const myCategoryTools = [myNewTool]
```

Then update the main `tools/index.ts` file to include your new category:

```typescript
import { ToolHandler } from "./types.js"
import { i18nTools } from "./i18n/index.js"
import { myCategoryTools } from "./my-category/index.js"

// Combine all tools from different categories
const allTools: ToolHandler[] = [
	...i18nTools,
	...myCategoryTools, // Add your new category here
]

export function getAllTools(): ToolHandler[] {
	return allTools
}

export function getToolByName(name: string): ToolHandler | undefined {
	return allTools.find((tool) => tool.name === name)
}

// Export all tools by category for direct access
export { i18nTools, myCategoryTools }
```

## Step 4: Test Your Tool

After adding your new tool, you can immediately test it since we're using TSX to run the TypeScript files directly:

You can test your tool using the MCP interface:

```javascript
await mcpHub.callTool("translation-mcp-server", "my_new_tool", {
	param1: "test",
	param2: 42,
})
```

## Best Practices

1. **Descriptive Names**: Choose clear, descriptive names for your tools that indicate their function.
2. **Thorough Documentation**: Document your tool's purpose, parameters, and usage examples.
3. **Input Validation**: Validate input parameters and provide helpful error messages.
4. **Consistent Error Handling**: Follow the established error handling pattern for consistent behavior.
5. **Logging**: Use console.error for logging to help with debugging.
6. **Modular Design**: Keep each tool focused on a specific task for better maintainability.
7. **Testing**: Consider adding unit tests for your tools to ensure they work as expected.
