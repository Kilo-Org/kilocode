import { parametersSchema, defineCustomTool } from "@roo-code/types"

// This is a valid tool.
export const validTool = defineCustomTool({
	name: "mixed_validTool",
	description: "Valid",
	parameters: parametersSchema.object({}),
	async execute() {
		return "valid"
	},
})

// These should be silently skipped.
export const someString = "not a tool"
export const someNumber = 42
export const someObject = { foo: "bar" }
