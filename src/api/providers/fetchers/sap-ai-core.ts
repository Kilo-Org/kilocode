// kilocode_change - new file
import axios from "axios"
import { ModelInfo } from "@roo-code/types"
import type { ModelRecord } from "../../../shared/api"

// Cache for mapping model IDs to providers
const modelProviderCache: Record<string, Provider> = {}

interface Deployment {
	id: string
	name: string
	model: string
	targetStatus: string
}

interface Token {
	access_token: string
	expires_in: number
	scope: string
	jti: string
	token_type: string
	expires_at: number
}

export interface SapAiCoreModel {
	model: string
	provider: Provider
	allowedScenarios: Scenario[]
	modelInfo: ModelInfo
	deployments?: Deployment[]
}

const PROVIDERS = ["Amazon", "Anthropic", "Google", "OpenAI", "Mistral AI"] as const
export type Provider = (typeof PROVIDERS)[number]
export type Scenario = "Foundation" | "Orchestration"
export type DeploymentRecord = Record<string, Deployment>

interface SapAiCoreConfig {
	serviceKey?: string
	resourceGroup?: string
}

interface SapAiCoreServiceKeyConfig {
	clientid: string
	clientsecret: string
	url: string
	identityzone?: string
	identityzoneid?: string
	appname?: string
	"credential-type"?: string
	serviceurls: {
		AI_API_URL: string
	}
}

class SapAiCoreFetcher {
	private serviceKeyConfig: SapAiCoreServiceKeyConfig

	constructor(private config: SapAiCoreConfig) {
		this.config.resourceGroup = config.resourceGroup || "default"

		if (!this.config.serviceKey) {
			throw new Error("SAP AI Core service key is required")
		}

		try {
			this.serviceKeyConfig = JSON.parse(this.config.serviceKey) as SapAiCoreServiceKeyConfig
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Failed to parse SAP AI Core service key: ${error.message}`)
			}
			throw new Error("Failed to parse SAP AI Core service key")
		}
	}

	async getDeployments(): Promise<DeploymentRecord> {
		return this.fetchDeployments()
	}

	async getModels(): Promise<Record<string, SapAiCoreModel>> {
		return this.fetchModels()
	}

	private async getToken(): Promise<string> {
		const token = await this.authenticate()
		return token.access_token
	}

	private async authenticate(): Promise<Token> {
		const payload = {
			grant_type: "client_credentials",
			client_id: this.serviceKeyConfig.clientid,
			client_secret: this.serviceKeyConfig.clientsecret,
		}

		const tokenUrl = this.serviceKeyConfig.url.replace(/\/+$/, "") + "/oauth/token"

		try {
			const response = await axios.post(tokenUrl, payload, {
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
			})

			const token = response.data as Token
			token.expires_at = Date.now() + token.expires_in * 1000
			return token
		} catch (error) {
			console.error("Authentication failed:", error)
			throw new Error("Failed to authenticate with SAP AI Core")
		}
	}

	private async getHeaders(): Promise<Record<string, string>> {
		const token = await this.getToken()
		return {
			Authorization: `Bearer ${token}`,
			"AI-Resource-Group": this.config.resourceGroup!,
			"Content-Type": "application/json",
			"AI-Client-Type": "Cline",
		}
	}

	async fetchModels(): Promise<Record<string, SapAiCoreModel>> {
		const headers = await this.getHeaders()
		const baseUrl = this.serviceKeyConfig.serviceurls.AI_API_URL
		const url = `${baseUrl}/v2/lm/scenarios/foundation-models/models`
		const deploymentsUrl = `${baseUrl}/v2/lm/deployments?$top=10000&$skip=0`

		try {
			const [modelsResponse, deploymentsResponse] = await Promise.all([
				axios.get(url, { headers }),
				axios.get(deploymentsUrl, { headers }),
			])

			const allModels = modelsResponse.data.resources
			const allDeployments = deploymentsResponse.data.resources

			// Transform deployments
			const deployments: DeploymentRecord = {}
			allDeployments.forEach((deployment: any) => {
				const transformedDeployment = this.transformDeployment(deployment)
				if (transformedDeployment) {
					deployments[transformedDeployment.id] = transformedDeployment
				}
			})

			// Filter raw models first, then transform
			const filteredRawModels = this.filterRawModels(allModels)
			return this.transformModels(filteredRawModels, Object.values(deployments))
		} catch (error) {
			console.error("Error fetching SAP AI Core models:", error)
			throw new Error("Failed to fetch SAP AI Core models")
		}
	}

	private filterRawModels(allModels: any[]): any[] {
		return allModels.filter((model: any) => {
			// Filter: Supported providers only
			if (!this.isSupportedProvider(model.provider)) return false

			// Find the latest version and apply streaming/text-generation filters
			const latestVersion = model.versions?.find((version: any) => version.isLatest === true)
			if (!latestVersion) return false

			// Filter: Must support streaming
			if (!latestVersion.streamingSupported) return false

			// Filter: Must support text-generation
			if (!latestVersion.capabilities?.includes("text-generation")) return false

			// Filter: Context window must be at least 32000
			return !(!latestVersion.contextLength || latestVersion.contextLength < 32000)
		})
	}

	private async fetchDeployments(): Promise<DeploymentRecord> {
		const headers = await this.getHeaders()
		const baseUrl = this.serviceKeyConfig.serviceurls.AI_API_URL
		const url = `${baseUrl}/v2/lm/deployments?$top=10000&$skip=0`

		try {
			const response = await axios.get(url, { headers })
			const allDeployments = response.data.resources

			const deployments: DeploymentRecord = {}

			allDeployments.forEach((deployment: any) => {
				const transformedDeployment = this.transformDeployment(deployment)
				if (transformedDeployment) {
					deployments[transformedDeployment.id] = transformedDeployment
				}
			})

			return deployments
		} catch (error) {
			console.error("Error fetching SAP AI Core deployments:", error)
			throw new Error("Failed to fetch SAP AI Core deployments")
		}
	}

	private transformDeployment(deployment: any): Deployment | null {
		const model = deployment.details?.resources?.backend_details?.model
		if (!model?.name || !model?.version) {
			return null
		}

		return {
			id: deployment.id,
			name: `${model.name}:${model.version}`,
			model: model.name,
			targetStatus: deployment.targetStatus,
		}
	}

	private transformModels(allModels: any[], deployments: Deployment[]): Record<string, SapAiCoreModel> {
		const result: Record<string, SapAiCoreModel> = {}

		allModels.forEach((model: any) => {
			const transformedModel = this.transformModel(model, deployments)
			if (transformedModel) {
				result[model.model] = transformedModel
			}
		})

		return result
	}

	private transformModel(model: any, deployments: Deployment[]): SapAiCoreModel | null {
		const latestVersion = model.versions?.find((version: any) => version.isLatest === true)
		if (!latestVersion) {
			return null
		}

		const allowedScenarios = this.mapScenarios(model.allowedScenarios)
		const modelInfo = this.createModelInfo(latestVersion, model)
		const modelDeployments = this.findModelDeployments(model.model, deployments)

		return {
			model: model.model,
			provider: model.provider as Provider,
			allowedScenarios,
			modelInfo,
			deployments: modelDeployments,
		}
	}

	private mapScenarios(scenarios: any[]): Scenario[] {
		return scenarios
			.map((scenario: any) => {
				if (scenario.scenarioId === "foundation-models") return "Foundation"
				if (scenario.scenarioId === "orchestration") return "Orchestration"
				return null
			})
			.filter((scenario: Scenario | null): scenario is Scenario => scenario !== null)
	}

	private createModelInfo(latestVersion: any, model: any): ModelInfo {
		const inputCost = latestVersion.cost?.find((c: any) => c.inputCost)?.inputCost
		const outputCost = latestVersion.cost?.find((c: any) => c.outputCost)?.outputCost

		return {
			contextWindow: latestVersion.contextLength,
			supportsImages:
				latestVersion.inputTypes?.includes("image") ||
				latestVersion.capabilities?.includes("image-recognition"),
			supportsPromptCache: false,
			inputPrice: inputCost ? parseFloat(inputCost) : undefined,
			outputPrice: outputCost ? parseFloat(outputCost) : undefined,
			description: model.description,
			displayName: model.displayName,
			preferredIndex: undefined,
		}
	}

	private findModelDeployments(modelName: string, deployments: Deployment[]): Deployment[] {
		const modelBaseName = modelName.split(":")[0].toLowerCase()
		return deployments.filter((deployment) => {
			const deploymentBaseName = deployment.name.split(":")[0].toLowerCase()
			return deploymentBaseName === modelBaseName
		})
	}

	private isSupportedProvider(value: string): value is Provider {
		return PROVIDERS.includes(value as Provider)
	}
}

export async function getSapAiCoreModels(
	sapAiCoreServiceKey?: string,
	sapAiCoreResourceGroup?: string,
	sapAiCoreUseOrchestration?: boolean,
): Promise<ModelRecord> {
	const client = new SapAiCoreFetcher({
		serviceKey: sapAiCoreServiceKey,
		resourceGroup: sapAiCoreResourceGroup,
	})

	const allModels = await client.getModels()
	const filteredModels = filterModelsByScenario(allModels, sapAiCoreUseOrchestration)

	// Populate the model-to-provider cache
	populateModelProviderCache(filteredModels)

	const modelRecord: ModelRecord = {}

	Object.entries(filteredModels).forEach(([modelId, sapAiCoreModel]) => {
		modelRecord[modelId] = sapAiCoreModel.modelInfo
	})

	return modelRecord
}

export async function getSapAiCoreDeployments(
	sapAiCoreServiceKey?: string,
	sapAiCoreResourceGroup: string = "default",
): Promise<DeploymentRecord> {
	const client = new SapAiCoreFetcher({
		serviceKey: sapAiCoreServiceKey,
		resourceGroup: sapAiCoreResourceGroup,
	})

	return client.getDeployments()
}

// Helper function to filter models by scenario and context window
function filterModelsByScenario(
	allModels: Record<string, SapAiCoreModel>,
	sapAiCoreUseOrchestration?: boolean,
): Record<string, SapAiCoreModel> {
	const filteredModels: Record<string, SapAiCoreModel> = {}

	// Filter models based on scenario (context window filtering already done in fetchModels)
	Object.entries(allModels).forEach(([modelId, sapAiCoreModel]) => {
		// If no orchestration preference specified, include all models
		if (sapAiCoreUseOrchestration === undefined) {
			filteredModels[modelId] = sapAiCoreModel
			return
		}

		const hasOrchestration = sapAiCoreModel.allowedScenarios.includes("Orchestration")
		const hasFoundation = sapAiCoreModel.allowedScenarios.includes("Foundation")

		// If useOrchestration is true, only include models that support orchestration
		// If useOrchestration is false, only include foundation models that are also supported
		if (sapAiCoreUseOrchestration) {
			// For orchestration, include all models that support orchestration
			if (hasOrchestration) {
				filteredModels[modelId] = sapAiCoreModel
			}
		} else {
			// For foundation models, check both foundation support AND if the model is in our supported list
			if (hasFoundation && isProviderSupportedByFoundation(sapAiCoreModel)) {
				filteredModels[modelId] = sapAiCoreModel
			}
		}
	})

	return filteredModels
}

// SAP AI Core's official SDK currently only supports OpenAI models.
function isProviderSupportedByFoundation(sapAiCoreModel: SapAiCoreModel): boolean {
	return sapAiCoreModel.provider === "OpenAI"
}

/**
 * Populate the model-to-provider cache with fetched models (only by modelId)
 */
function populateModelProviderCache(models: Record<string, SapAiCoreModel>): void {
	// Clear cache by creating new empty object
	Object.keys(modelProviderCache).forEach((key) => delete modelProviderCache[key])

	Object.entries(models).forEach(([modelId, sapAiCoreModel]) => {
		modelProviderCache[modelId] = sapAiCoreModel.provider
	})
}

/**
 * Get the provider for a given model ID
 * @param modelId - The model ID to look up
 * @returns The provider for the model, or undefined if not found
 */
export function getProviderForModel(modelId?: string): Provider | undefined {
	return modelId ? modelProviderCache[modelId] : undefined
}
