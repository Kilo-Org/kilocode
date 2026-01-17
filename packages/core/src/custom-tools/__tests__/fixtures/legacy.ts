import { parametersSchema, defineCustomTool } from "@roo-code/types"

export default defineCustomTool({
	name: "legacy",
	description: "Legacy tool using args",
	parameters: parametersSchema.object({ input: parametersSchema.string().describe("The input string") }),
	async execute(args: { input: string }) {
		return args.input
	},
})
