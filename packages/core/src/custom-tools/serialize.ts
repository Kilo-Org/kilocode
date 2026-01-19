import { type SerializedCustomToolDefinition, parametersSchema } from "@roo-code/types"

import type { StoredCustomTool } from "./types.js"

export function serializeCustomTool({
	name,
	description,
	parameters,
	source,
}: StoredCustomTool): SerializedCustomToolDefinition {
	return {
		name,
		description,
		parameters: parameters ? parametersSchema.toJSONSchema(parameters) : undefined,
		source,
	}
}

export function serializeCustomTools(tools: StoredCustomTool[]): SerializedCustomToolDefinition[] {
	return tools.map(serializeCustomTool)
}
