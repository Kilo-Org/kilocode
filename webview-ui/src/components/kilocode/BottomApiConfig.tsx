import { ModelSelector } from "./chat/ModelSelector"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useSelectedModel } from "../ui/hooks/useSelectedModel"
import { ProviderSettings } from "@roo-code/types"

export const BottomApiConfig = () => {
	const { currentApiConfigName, apiConfiguration } = useExtensionState()
	const { id: selectedModelId, provider: selectedProvider } = useSelectedModel(apiConfiguration)

	return (
		<>
			<div className="w-auto overflow-hidden">
				<ModelSelector
					currentApiConfigName={currentApiConfigName}
					apiConfiguration={apiConfiguration as ProviderSettings}
					fallbackText={`${selectedProvider}:${selectedModelId}`}
				/>
			</div>
		</>
	)
}
