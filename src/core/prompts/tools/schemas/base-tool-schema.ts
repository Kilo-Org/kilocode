/**
 * Base tool schema that can generate both XML descriptions and native function call schemas
 */

import Anthropic from "@anthropic-ai/sdk"
import { ToolArgs } from "../types"

export interface ToolParameter {
	name?: string
	type: "string" | "number" | "boolean" | "object" | "array"
	description?: string
	required?: boolean
	enum?: string[]
	items?: ToolParameter // For array types
	properties?: Record<string, ToolParameter> // For object types
}

export interface BaseToolSchema {
	name: string
	description: string
	parameters: ToolParameter[]
	customDescription?: (args: ToolArgs) => BaseToolSchema | undefined
	systemPrompt?: string
}

/**
 * Recursively converts ToolParameter to JSON Schema property
 */
function toolParamToSchema(param: ToolParameter): any {
	const schema: any = {
		type: param.type,
	}
	if (param.description) {
		schema.description = param.description
	}
	if (param.enum) {
		schema.enum = param.enum
	}
	if (param.type === "array" && param.items) {
		schema.items = toolParamToSchema(param.items)
	}
	if (param.type === "object" && param.properties) {
		schema.properties = {}
		schema.required = []
		for (const [k, v] of Object.entries(param.properties)) {
			schema.properties[k] = toolParamToSchema(v)
			if (v.required) {
				schema.required.push(k)
			}
		}
		if (schema.required.length === 0) delete schema.required
	}
	return schema
}

/**
 * Converts a BaseToolSchema to OpenAI function call schema
 */
export function generateFunctionCallSchema(schema: BaseToolSchema) {
	const { name, description, parameters } = schema
	const properties: Record<string, any> = {}
	const required: string[] = []
	for (const param of parameters) {
		if (param.name) {
			properties[param.name] = toolParamToSchema(param)
			if (param.required) {
				required.push(param.name)
			}
		}
	}
	return {
		type: "function",
		function: {
			name,
			description,
			parameters: {
				type: "object",
				properties,
				required,
			},
		},
	}
}

/**
 * Converts a BaseToolSchema to Anthropic tool schema
 */
export function generateAnthropicToolSchema(schema: BaseToolSchema): Anthropic.ToolUnion {
	const { name, description, parameters } = schema
	const inputSchema: any = {
		type: "object",
		properties: {},
		required: [],
	}
	for (const param of parameters) {
		if (param.name) {
			inputSchema.properties[param.name] = toolParamToSchema(param)
			if (param.required) {
				inputSchema.required.push(param.name)
			}
		}
	}
	if (inputSchema.required.length === 0) delete inputSchema.required
	return {
		name,
		description,
		input_schema: inputSchema,
	}
}
