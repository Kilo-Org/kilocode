import type { ModelInfo } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"

type OcaCache = {
	models?: Record<string, ModelInfo>
	selectedModelId?: string
}

type StateShape = {
	modelService?: {
		oca?: OcaCache
	}
}

const STATE_KEY: keyof StateShape = "modelService"

function readState(): StateShape {
	const raw = (vscode.getState() as StateShape) || {}
	if (!raw[STATE_KEY]) raw[STATE_KEY] = { oca: {} }
	if (!raw[STATE_KEY]!.oca) raw[STATE_KEY]!.oca = {}
	return raw
}

function writeState(next: StateShape) {
	vscode.setState(next as unknown as any)
}

export class OCAModelService {
	// OCA MODELS
	static setOcaModels(models: Record<string, ModelInfo>): void {
		const state = readState()
		state[STATE_KEY]!.oca!.models = models
		writeState(state)
	}

	static getOcaModels(): Record<string, ModelInfo> {
		const state = readState()
		return state[STATE_KEY]!.oca!.models || {}
	}

	static getOcaFirstModelId(): string {
		const models = this.getOcaModels()
		const keys = Object.keys(models || {})
		return keys[0] || ""
	}

	static setOcaSelectedModelId(modelId: string): void {
		const state = readState()
		state[STATE_KEY]!.oca!.selectedModelId = modelId
		writeState(state)
	}

	static getOcaSelectedModelId(): string | undefined {
		const state = readState()
		return state[STATE_KEY]!.oca!.selectedModelId
	}

	static clearOcaSelection(): void {
		const state = readState()
		if (state[STATE_KEY]!.oca) {
			state[STATE_KEY]!.oca!.selectedModelId = undefined
		}
		writeState(state)
	}
}
