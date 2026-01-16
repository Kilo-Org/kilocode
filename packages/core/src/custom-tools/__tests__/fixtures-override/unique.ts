import { parametersSchema, defineCustomTool } from "@roo-code/types"

// This tool only exists in fixtures-override/ to test combined loading.
export default defineCustomTool({
	name: "unique_override",
	description: "A unique tool only in override directory",
	parameters: parametersSchema.object({ input: parametersSchema.string().describe("The input") }),
	async execute(args: { input: string }) {
		return "Unique: " + args.input
	},
})
