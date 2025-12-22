import { Anthropic } from "@anthropic-ai/sdk"
import { CacheControlEphemeral } from "@anthropic-ai/sdk/resources"
import { AnthropicHandler } from "./anthropic"
import type { ApiHandlerOptions } from "../../shared/api"

export class ClaudeCodeNativeHandler extends AnthropicHandler {
	constructor(options: ApiHandlerOptions) {
		// Force anthropicUseAuthToken to true so that the Anthropic SDK uses 'Authorization: Bearer'
		// instead of 'x-api-key'.
		// Also force anthropicDeploymentName to undefined to prevent using Azure/AWS deployments.
		super({
			...options,
			anthropicUseAuthToken: true,
			anthropicDeploymentName: undefined,
		})

		// Override the client with custom headers
		this["client"] = new Anthropic({
			baseURL: options.anthropicBaseUrl || undefined,
			authToken: options.apiKey,
			defaultHeaders: {
				"anthropic-beta": "oauth-2025-04-20",
				"anthropic-version": "2023-06-01",
			},
		})
	}

	protected override getSystemPrompt(
		systemPrompt: string,
		cacheControl?: CacheControlEphemeral,
	): Anthropic.Messages.TextBlockParam[] {
		return [
			{
				type: "text",
				text: "You are Claude Code, Anthropic's official CLI for Claude.",
			},
			...super.getSystemPrompt(systemPrompt, cacheControl),
		]
	}
}
