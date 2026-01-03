import { Anthropic } from "@anthropic-ai/sdk"
import { CacheControlEphemeral } from "@anthropic-ai/sdk/resources"
import { ANTHROPIC_DEFAULT_MAX_TOKENS } from "@roo-code/types"
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
				"user-agent": "claude-cli/2.0.76 (external, cli)",
				"x-app": "cli",
			},
		})
	}

	override getModel() {
		const baseModel = super.getModel()
		// Ensure required betas are always included in the betas array
		// These are required for Claude Code Native functionality
		const betas = baseModel.betas ?? []
		const requiredBetas = ["oauth-2025-04-20"]
		for (const beta of requiredBetas) {
			if (!betas.includes(beta)) {
				betas.push(beta)
			}
		}
		return {
			...baseModel,
			betas,
		}
	}

	/**
	 * Override completePrompt to ensure the required beta headers are included.
	 * The parent implementation doesn't pass beta headers, which causes auth failures
	 * for Claude Code Native which requires the oauth beta.
	 */
	override async completePrompt(prompt: string): Promise<string> {
		const { id: model, temperature, betas } = this.getModel()

		const message = await this.client.messages.create(
			{
				model,
				max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
				thinking: undefined,
				temperature,
				messages: [{ role: "user", content: prompt }],
				stream: false,
			},
			{
				headers: { "anthropic-beta": betas?.join(",") },
			},
		)

		const content = message.content.find(({ type }) => type === "text")
		return content?.type === "text" ? content.text : ""
	}

	protected override getSystemPrompt(
		systemPrompt: string,
		cacheControl?: CacheControlEphemeral,
	): Anthropic.Messages.TextBlockParam[] {
		return [
			{
				cache_control: {
					type: "ephemeral",
				},
				type: "text",
				text: "You are Claude Code, Anthropic's official CLI for Claude.",
			},
			...super.getSystemPrompt(systemPrompt, cacheControl),
		]
	}
}
