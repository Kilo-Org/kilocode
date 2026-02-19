// kilocode_change - new file
import { BedrockClient, GetInferenceProfileCommand } from "@aws-sdk/client-bedrock"
import type { BedrockClientConfig } from "@aws-sdk/client-bedrock"
import { fromIni } from "@aws-sdk/credential-providers"
import type { ProviderSettings } from "@roo-code/types"
import { logger } from "../../utils/logging"

/**
 * Information about the underlying model resolved from an inference profile
 */
export interface ResolvedInferenceProfileModel {
	modelId: string
	modelArn: string
}

/**
 * Resolves an application-inference-profile or inference-profile ARN to its underlying model
 * Uses AWS Bedrock GetInferenceProfile API to retrieve model information
 */
export class BedrockInferenceProfileResolver {
	private client: BedrockClient | null = null
	private cache: Map<string, ResolvedInferenceProfileModel> = new Map()

	constructor(private options: ProviderSettings) {
		// Initialize the Bedrock client (not BedrockRuntime) for control plane operations
		this.initializeClient()
	}

	private initializeClient(): void {
		try {
			const clientConfig: BedrockClientConfig = {
				region: this.options.awsRegion,
				// Add the endpoint configuration when specified and enabled
				...(this.options.awsBedrockEndpoint &&
					this.options.awsBedrockEndpointEnabled && { endpoint: this.options.awsBedrockEndpoint }),
			}

			if (this.options.awsUseApiKey && this.options.awsApiKey) {
				// Use API key/token-based authentication if enabled and API key is set
				clientConfig.token = { token: this.options.awsApiKey }
				clientConfig.authSchemePreference = ["httpBearerAuth"]
			} else if (this.options.awsUseProfile && this.options.awsProfile) {
				// Use profile-based credentials if enabled and profile is set
				clientConfig.credentials = fromIni({
					profile: this.options.awsProfile,
					ignoreCache: true,
				})
			} else if (this.options.awsAccessKey && this.options.awsSecretKey) {
				// Use direct credentials if provided
				clientConfig.credentials = {
					accessKeyId: this.options.awsAccessKey,
					secretAccessKey: this.options.awsSecretKey,
					...(this.options.awsSessionToken ? { sessionToken: this.options.awsSessionToken } : {}),
				}
			}

			this.client = new BedrockClient(clientConfig)
		} catch (error) {
			logger.error("Failed to initialize Bedrock client for inference profile resolution", {
				ctx: "bedrock-resolver",
				error: error instanceof Error ? error.message : String(error),
			})
			this.client = null
		}
	}

	/**
	 * Resolves an inference profile ARN to get the underlying model information
	 * @param inferenceProfileArn The ARN of the inference profile to resolve
	 * @returns Promise with the resolved model information, or null if resolution fails
	 */
	async resolveInferenceProfile(inferenceProfileArn: string): Promise<ResolvedInferenceProfileModel | null> {
		// Check cache first
		if (this.cache.has(inferenceProfileArn)) {
			logger.info("Using cached inference profile resolution", {
				ctx: "bedrock-resolver",
				arn: inferenceProfileArn,
			})
			return this.cache.get(inferenceProfileArn)!
		}

		if (!this.client) {
			logger.error("Bedrock client not initialized, cannot resolve inference profile", {
				ctx: "bedrock-resolver",
				arn: inferenceProfileArn,
			})
			return null
		}

		try {
			logger.info("Resolving inference profile ARN", {
				ctx: "bedrock-resolver",
				arn: inferenceProfileArn,
			})

			const command = new GetInferenceProfileCommand({
				inferenceProfileIdentifier: inferenceProfileArn,
			})

			const response = await this.client.send(command)

			// Extract model information from response
			// The response structure includes a 'models' array with model ARNs
			if (response.models && response.models.length > 0) {
				const firstModel = response.models[0]
				const modelArn = firstModel.modelArn || ""

				// Extract model ID from ARN
				// ARN format: arn:aws:bedrock:region:account:foundation-model/model-id
				const modelId = this.extractModelIdFromArn(modelArn)

				if (modelId) {
					const result: ResolvedInferenceProfileModel = {
						modelId,
						modelArn,
					}

					// Cache the result
					this.cache.set(inferenceProfileArn, result)

					logger.info("Successfully resolved inference profile", {
						ctx: "bedrock-resolver",
						arn: inferenceProfileArn,
						modelId,
					})

					return result
				}
			}

			logger.warn("No model information found in inference profile response", {
				ctx: "bedrock-resolver",
				arn: inferenceProfileArn,
			})
			return null
		} catch (error) {
			logger.error("Failed to resolve inference profile", {
				ctx: "bedrock-resolver",
				arn: inferenceProfileArn,
				error: error instanceof Error ? error.message : String(error),
			})
			return null
		}
	}

	/**
	 * Extracts the model ID from a Bedrock model ARN
	 * @param arn The full ARN of the model
	 * @returns The model ID, or empty string if extraction fails
	 */
	private extractModelIdFromArn(arn: string): string {
		// ARN format: arn:aws:bedrock:region:account:foundation-model/model-id
		// or: arn:aws:bedrock:region:account:resource-type/resource-id
		const arnRegex = /^arn:[^:]+:bedrock:[^:]+:[^:]*:(?:[^\/]+)\/([\w\.\-:]+)$/
		const match = arn.match(arnRegex)

		if (match && match[1]) {
			return match[1]
		}

		return ""
	}

	/**
	 * Determines if an ARN should be resolved (application-inference-profile or inference-profile)
	 * @param arn The ARN to check
	 * @returns True if the ARN should be resolved
	 */
	static shouldResolveArn(arn: string): boolean {
		return arn.includes(":application-inference-profile/") || arn.includes(":inference-profile/")
	}

	/**
	 * Clear the cache (useful for testing or forcing refresh)
	 */
	clearCache(): void {
		this.cache.clear()
	}
}
