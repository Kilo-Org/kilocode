import type OpenAI from "openai"

export default function execute_command(cwd: string): OpenAI.Chat.ChatCompletionTool {
	return {
		type: "function",
		function: {
			name: "execute_command",
			description:
				"Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. For command chaining, use the appropriate chaining syntax for the user's shell. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Prefer relative commands and paths that avoid location sensitivity for terminal consistency, e.g: \`touch ./testdata/example.file\`, \`dir ./examples/model1/data/yaml\`, or \`go test ./cmd/front --config ./cmd/front/config.yml\`. If directed by the user, you may open a terminal in a different directory by using the \`cwd\` parameter.",
			strict: true,
			parameters: {
				type: "object",
				properties: {
					command: {
						type: "string",
						description: "Shell command to execute",
					},
					cwd: {
						type: ["string", "null"],
						description: `The working directory to execute the command in (default: ${cwd})`,
					},
				},
				required: ["command", "cwd"],
				additionalProperties: false,
			},
		},
	}
}
