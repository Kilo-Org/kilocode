import { ModelSelector } from "./chat/ModelSelector"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useSelectedModel } from "../ui/hooks/useSelectedModel"

export const BottomApiConfig = () => {
	const { currentApiConfigName, apiConfiguration, virtualQuotaActiveModel } = useExtensionState()
	const { id: selectedModelId, provider: selectedProvider } = useSelectedModel(apiConfiguration)

	if (!apiConfiguration) {
		return null
	}

	return (
		<>
			<div className="w-auto overflow-hidden">
				<ModelSelector
					currentApiConfigName={currentApiConfigName}
					apiConfiguration={apiConfiguration}
					fallbackText={`${selectedProvider}:${selectedModelId}`}
					virtualQuotaActiveModel={
						virtualQuotaActiveModel
							? { id: virtualQuotaActiveModel.id, name: virtualQuotaActiveModel.id }
							: undefined
					}
				/>
			</div>
		</>
	)
}
