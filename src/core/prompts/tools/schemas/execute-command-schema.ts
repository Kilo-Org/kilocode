import { ToolArgs } from "../types"
import { BaseToolSchema } from "./base-tool-schema"

export function generateExecuteCommandSchema(args: ToolArgs): BaseToolSchema {
	const schema: BaseToolSchema = {
		name: "execute_command",
		description:
			"Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. For command chaining, use the appropriate chaining syntax for the user's shell. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Prefer relative commands and paths that avoid location sensitivity for terminal consistency, e.g: `touch ./testdata/example.file`, `dir ./examples/model1/data/yaml`, or `go test ./cmd/front --config ./cmd/front/config.yml`. If directed by the user, you may open a terminal in a different directory by using the `cwd` parameter.",
		parameters: [
			{
				name: "command",
				type: "string",
				description:
					"The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.",
				required: true,
			},
			{
				name: "cwd",
				type: "string",
				description: `The working directory to execute the command in (default: ${args.cwd})`,
				required: false,
			},
		],
	}

	return schema
}
