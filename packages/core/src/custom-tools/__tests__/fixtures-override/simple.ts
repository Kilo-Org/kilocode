import { parametersSchema, defineCustomTool } from "@roo-code/types"

// This tool has the same name as the one in fixtures/ to test override behavior.
export default defineCustomTool({
	name: "simple",
	description: "Simple tool - OVERRIDDEN",
	parameters: parametersSchema.object({ value: parametersSchema.string().describe("The input value") }),
	async execute(args: { value: string }) {
		return "Overridden Result: " + args.value
	},
})
