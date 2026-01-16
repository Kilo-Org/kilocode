import { parametersSchema, defineCustomTool } from "@roo-code/types"

export const toolA = defineCustomTool({
	name: "multi_toolA",
	description: "Tool A",
	parameters: parametersSchema.object({}),
	async execute() {
		return "A"
	},
})

export const toolB = defineCustomTool({
	name: "multi_toolB",
	description: "Tool B",
	parameters: parametersSchema.object({}),
	async execute() {
		return "B"
	},
})
