import { ModelSelector } from "./chat/ModelSelector"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useSelectedModel } from "../ui/hooks/useSelectedModel"

export const BottomApiConfig = () => {
	const { currentApiConfigName, apiConfiguration, virtualQuotaActiveModel, intelligentActiveModel } =
		useExtensionState() // kilocode_change: Get virtual quota and intelligent active models for UI display
	const { id: selectedModelId, provider: selectedProvider } = useSelectedModel(apiConfiguration)

	if (!apiConfiguration) {
		return null
	}

	return (
		<>
			{/* kilocode_change - add data-testid="model-selector" below */}
			<div className="w-auto overflow-hidden" data-testid="model-selector">
				<ModelSelector
					currentApiConfigName={currentApiConfigName}
					apiConfiguration={apiConfiguration}
					fallbackText={`${selectedProvider}:${selectedModelId}`}
					//kilocode_change: Pass virtual quota active model to ModelSelector
					virtualQuotaActiveModel={
						virtualQuotaActiveModel
							? {
									id: virtualQuotaActiveModel.id,
									name: virtualQuotaActiveModel.id,
									activeProfileNumber: virtualQuotaActiveModel.activeProfileNumber,
								}
							: undefined
					}
					//kilocode_change: Pass intelligent active model to ModelSelector
					intelligentActiveModel={
						intelligentActiveModel
							? { id: intelligentActiveModel.id, name: intelligentActiveModel.id }
							: undefined
					}
				/>
			</div>
		</>
	)
}
